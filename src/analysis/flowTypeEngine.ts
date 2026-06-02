/**
 * Flow-sensitive type engine (Phase B).
 *
 * Computes, once, a per-program-point type environment over the CFG, to become
 * the single source of truth for "type of an lvalue at position P" — replacing
 * the ~7 ad-hoc narrowing paths that diverge today (see the Phase B plan).
 *
 * THIS FILE IS BUILT INCREMENTALLY AND IS NOT YET WIRED TO ANY CONSUMER:
 *   B0 (this commit): the dataflow framework — worklist + fixpoint + env merge,
 *       with a pluggable transfer function (default: identity). No type logic,
 *       no consumers → behavior-neutral.
 *   B1: assignment/declaration transfer (env[x] = checked RHS type).
 *   B2: guard transfer on branch edges (reuse collectGuards/applyTypeGuard).
 *   B3: join at merges + loop fixpoint widening.
 *   B4: shadow-validate vs current narrowing. B5: flip consumers. B6: delete dups.
 */

import { BasicBlock, ControlFlowGraph } from './cfg/types';
import { AstNode } from '../ast/nodes';
import { UcodeType, UcodeDataType, createUnionType, getUnionTypes } from './symbolTable';

/** An lvalue key is an identifier name or a constant member path ("parts[5]",
 *  "o.name") — the same key space getDottedPath produces. */
export type LValueKey = string;

/** The narrowed type of each tracked lvalue at a program point. */
export type FlowEnvironment = ReadonlyMap<LValueKey, UcodeDataType>;

/**
 * Statement-level transfer: given the environment before a straight-line
 * statement, mutate it to reflect the statement's effect (declaration/assignment
 * → rebind a variable). Mutates in place for efficiency; the engine clones at
 * block boundaries. B0 ships identity; B1 supplies the assignment transfer.
 */
export type StmtTransferFn = (stmt: AstNode, env: Map<LValueKey, UcodeDataType>) => void;

const identityStmtTransfer: StmtTransferFn = () => {};

/**
 * B1 — assignment/declaration transfer. Walks a block's straight-line statements
 * and updates the environment: `let x = e` / `x = e` set env[x] to the CHECKED
 * type of the RHS (via `typeOf`, i.e. typeChecker.getTypeOf). Because that
 * checked type already carries reassignment / nullMeansWrongType narrowing
 * (`x = substr(x,1)` → string, not string|null), the engine captures the
 * narrowing the SSA-effective base missed (Phase A step 2 / T55). An
 * uninitialized `let x;` sets env[x] = null (ucode's uninitialized value).
 *
 * `typeOf` returns undefined when a node has no checked type — then we leave the
 * binding alone (don't clobber a known type with unknown).
 */
export function makeAssignmentTransfer(typeOf: (node: AstNode) => UcodeDataType | undefined): StmtTransferFn {
  return (stmt, env) => {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of ((stmt as any).declarations ?? [])) {
        if (d?.id?.type !== 'Identifier') continue;
        if (d.init) {
          const t = typeOf(d.init);
          if (t !== undefined) env.set(d.id.name, t);
        } else {
          env.set(d.id.name, UcodeType.NULL); // `let x;` → null
        }
      }
    } else if (stmt.type === 'ExpressionStatement') {
      const expr = (stmt as any).expression;
      if (expr?.type === 'AssignmentExpression' && expr.operator === '=' && expr.left?.type === 'Identifier') {
        const t = typeOf(expr.right);
        if (t !== undefined) env.set(expr.left.name, t);
      }
    }
  };
}

/** Lattice JOIN of two types — the union of everything either side can be. Used
 *  at control-flow merge points (a variable narrowed differently on two incoming
 *  paths is, after the merge, either). `createUnionType` dedups and collapses a
 *  singleton, so join is idempotent and commutative. */
export function joinTypes(a: UcodeDataType, b: UcodeDataType): UcodeDataType {
  if (typesEqual(a, b)) return a;
  return createUnionType([...getUnionTypes(a), ...getUnionTypes(b)]);
}

/**
 * Merge environments from multiple predecessors. A key is kept only when it is
 * present on ALL incoming paths (sound: only treat a variable as narrowed when
 * every path agrees it exists), and its type is the join across paths. With no
 * predecessors (the entry block) the environment is empty.
 */
export function joinEnvironments(envs: FlowEnvironment[]): FlowEnvironment {
  if (envs.length === 0) return new Map();
  if (envs.length === 1) return envs[0]!;
  const [first, ...rest] = envs;
  const out = new Map<LValueKey, UcodeDataType>();
  for (const [key, type] of first!) {
    let joined: UcodeDataType = type;
    let inAll = true;
    for (const other of rest) {
      const t = other.get(key);
      if (t === undefined) { inAll = false; break; }
      joined = joinTypes(joined, t);
    }
    if (inAll) out.set(key, joined);
  }
  return out;
}

/** Stable structural equality for the fixpoint check (types are small plain
 *  values — strings or shallow objects — so a canonical stringify suffices). */
function typesEqual(a: UcodeDataType, b: UcodeDataType): boolean {
  if (a === b) return true;
  return canonical(a) === canonical(b);
}
function canonical(t: UcodeDataType): string {
  if (typeof t === 'string') return t;
  // Union: order-independent so {string|null} === {null|string}.
  const u = getUnionTypes(t);
  if (u.length > 1) return '|' + u.map(canonical).sort().join('|');
  return JSON.stringify(t);
}
function envsEqual(a: FlowEnvironment, b: FlowEnvironment): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv === undefined || !typesEqual(v, bv)) return false;
  }
  return true;
}

export class FlowTypeEngine {
  private readonly inEnv = new Map<number, FlowEnvironment>();
  private readonly outEnv = new Map<number, FlowEnvironment>();
  /** Environment ENTERING each top-level block statement (final fixpoint pass) —
   *  the reassignment-narrowed base of any variable referenced inside it. */
  private readonly stmtEntry = new Map<AstNode, FlowEnvironment>();
  /** Iterations actually run, for tests/diagnostics. */
  public iterations = 0;

  constructor(
    private readonly cfg: ControlFlowGraph,
    private readonly transfer: StmtTransferFn = identityStmtTransfer,
    /** Seed for the entry block — the function's parameters and their declared
     *  types. Parameters aren't `let`-declared in the body, so without this they
     *  wouldn't appear in the environment (and a join would drop a param that's
     *  only reassigned on some paths). */
    private readonly entryEnv: FlowEnvironment = new Map(),
  ) {}

  /** Fold the statement transfer over a block, recording per-statement entry
   *  environments. Returns the block's exit environment. */
  private runBlock(block: BasicBlock, inEnv: FlowEnvironment): FlowEnvironment {
    const env = new Map(inEnv);
    for (const stmt of block.statements) {
      this.stmtEntry.set(stmt, new Map(env)); // env as the statement is reached
      this.transfer(stmt, env);
    }
    return env;
  }

  /** Run the forward dataflow to a fixpoint (worklist algorithm). Terminates
   *  because the type lattice has finite height (a finite set of base types,
   *  joined into bounded unions); a hard iteration cap is a widening backstop. */
  compute(): void {
    const empty: FlowEnvironment = new Map();
    for (const b of this.cfg.blocks) {
      this.inEnv.set(b.id, empty);
      this.outEnv.set(b.id, empty);
    }

    const worklist: BasicBlock[] = [...this.cfg.blocks];
    const cap = Math.max(64, this.cfg.blocks.length * this.cfg.blocks.length);
    let guard = 0;

    while (worklist.length > 0) {
      if (++guard > cap) break; // widening backstop — should never trigger in practice
      this.iterations = guard;
      const block = worklist.shift()!;

      const newIn = block.predecessors.length === 0
        ? this.entryEnv // entry block: seed with parameters
        : joinEnvironments(block.predecessors.map(p => this.outEnv.get(p.id) ?? empty));
      this.inEnv.set(block.id, newIn);

      const newOut = this.runBlock(block, newIn);
      if (!envsEqual(newOut, this.outEnv.get(block.id) ?? empty)) {
        this.outEnv.set(block.id, newOut);
        for (const edge of block.successors) {
          if (!worklist.includes(edge.target)) worklist.push(edge.target);
        }
      }
    }
  }

  /** Environment on entry to / exit from a block. */
  getInEnv(blockId: number): FlowEnvironment { return this.inEnv.get(blockId) ?? new Map(); }
  getOutEnv(blockId: number): FlowEnvironment { return this.outEnv.get(blockId) ?? new Map(); }

  /**
   * The reassignment-narrowed BASE type of `varName` as referenced at `offset`:
   * the environment entering the innermost block statement that contains the
   * offset. This is the type a guard layer (collectGuards) then narrows further.
   * Returns undefined when the offset isn't covered or the variable isn't tracked.
   */
  baseTypeAt(varName: LValueKey, offset: number): UcodeDataType | undefined {
    let best: AstNode | undefined;
    for (const stmt of this.stmtEntry.keys()) {
      if (offset >= stmt.start && offset <= stmt.end) {
        if (!best || (stmt.end - stmt.start) < (best.end - best.start)) best = stmt; // innermost
      }
    }
    return best ? this.stmtEntry.get(best)!.get(varName) : undefined;
  }
}
