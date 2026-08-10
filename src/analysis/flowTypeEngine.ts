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

import { type BasicBlock, type ControlFlowGraph } from './cfg/types';
import { type AstNode } from '../ast/nodes';
import { UcodeType, type UcodeDataType, createUnionType, getUnionTypes, isNeverType, singleTypeToBase } from './symbolTable';

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
 * Edge-level guard transfer (Phase C / C1): given a branch edge's condition and
 * whether it is the negative (else / false / early-exit fall-through) edge,
 * narrow the environment that flows along that edge. Mutates in place; the
 * engine passes a CLONE of the predecessor's out-env so the predecessor's own
 * state is untouched. Reuses the TypeChecker's guard extractors + applyTypeGuard
 * (injected by buildFlowEngines) so each guard form is authored in exactly one
 * place — this is what folds guard narrowing INTO the dataflow.
 */
export type EdgeGuardFn = (condition: AstNode, isNegative: boolean, env: Map<LValueKey, UcodeDataType>) => void;

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
      // For-in loop vars (stamped by cfgBuilder.visitForInStatement): initless in
      // the AST but iterator-assigned on every body iteration — recording `null`
      // here would poison every body read once the loop join carries it. Skip; the
      // symbol's element/key type is the fallback the reads should resolve to.
      if ('_forInLoopVar' in stmt && stmt._forInLoopVar) return;
      for (const d of (stmt.declarations ?? [])) {
        if (d?.id?.type !== 'Identifier') continue;
        if (d.init) {
          const t = typeOf(d.init);
          if (t !== undefined) env.set(d.id.name, t);
        } else {
          env.set(d.id.name, UcodeType.NULL); // `let x;` → null
        }
      }
    } else if (stmt.type === 'ExpressionStatement') {
      const expr = stmt.expression;
      if (expr?.type === 'AssignmentExpression' && expr.left?.type === 'Identifier') {
        if (expr.operator === '=') {
          const t = typeOf(expr.right);
          if (t !== undefined) env.set(expr.left.name, t);
        } else {
          // Compound assignment (`+=`, `??=`, …): the assignment EXPRESSION's own
          // checked type (cached by TypeChecker.checkAssignmentExpression, which
          // now computes `typeof(x_old op y)` — docs/tc-compound-assign-operator-typing.md)
          // is the correct new type. Previously this branch didn't match `operator
          // === '='`, so a compound assign left the flow env holding the STALE
          // pre-assignment type instead of invalidating/updating it.
          const t = typeOf(expr);
          if (t !== undefined) env.set(expr.left.name, t);
        }
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
  // BOTTOM/`never` is the join IDENTITY: a path that is IMPOSSIBLE (e.g. the falsy
  // edge of `if (obj)` where `obj` is an always-truthy object) contributes nothing
  // to the merge, so `join(T, ⊥) = T`. This MUST precede the `unknown` (TOP) rule —
  // otherwise `join(object, ⊥)` would fall through and, because `⊥` is an empty
  // union, widen back to `object|…`/unknown and poison the sibling path.
  if (isNeverType(a)) return b;
  if (isNeverType(b)) return a;
  // `unknown` is the lattice TOP ("could be anything"): if one incoming path is
  // unknown, the merge is unknown — NOT `T|unknown`. Without this, an `if` that
  // narrows on one path and falls through unguarded on the other would surface a
  // spurious `string|unknown` instead of collapsing back to the declared type.
  // `any` (json()/call() contract-any — see docs/tc-json-any-return-display.md) is
  // the same lattice TOP for check purposes, so it absorbs identically — no
  // `T|any` union is formed at a merge point either. DISPLAY choice: when `any`
  // is one of the two incoming types, prefer it over a bare `unknown` result (it's
  // strictly more informative — "provably any by contract" vs "no information");
  // when both sides are the generic `unknown` TOP, keep returning `unknown`.
  if (a === UcodeType.UNKNOWN || b === UcodeType.UNKNOWN || a === UcodeType.ANY || b === UcodeType.ANY) {
    return (a === UcodeType.ANY || b === UcodeType.ANY) ? UcodeType.ANY : UcodeType.UNKNOWN;
  }
  return createUnionType([...getUnionTypes(a), ...getUnionTypes(b)]);
}

/**
 * Merge environments from multiple predecessors. A key is kept only when it is
 * present on ALL incoming paths (sound: only treat a variable as narrowed when
 * every path agrees it exists), and its type is the join across paths. With no
 * predecessors (the entry block) the environment is empty.
 */
export function joinEnvironments(envs: FlowEnvironment[]): FlowEnvironment {
  const first = envs[0];
  if (first === undefined) return new Map();
  if (envs.length === 1) return first; // hot straight-line path: no allocation
  const out = new Map<LValueKey, UcodeDataType>();
  for (const [key, type] of first) {
    let joined: UcodeDataType = type;
    let inAll = true;
    for (let i = 1; i < envs.length; i++) {
      const t = envs[i]?.get(key);
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

/**
 * Widening operator (▽) for the loop back-edge. The type lattice is NOT
 * finite-height in practice: a rich `ArrayType`/`ObjectType` carries an element/
 * shape type, and joining tuples with DIFFERENT element shapes on each loop
 * iteration (`['args',[]]` vs `['code','']` vs `['file',…]`) produces an
 * ever-growing union (`array<string|array> | array<string|object> | …`) that the
 * fixpoint never closes on — it churns until the iteration cap and leaves nested
 * loop-body blocks stale. Widening collapses each union member to its BASE enum
 * once a variable's type is still changing on a loop revisit, bounding the height
 * at the finite set of base kinds (so `array<A>|array<B>|null` ▽ … = `array|null`).
 * That coarser type is exactly what the null-tracking diagnostic consumers need
 * (is it null / may-null / non-null); precise element types for hover come from
 * the symbol table, not the engine. Applied ONLY when old≠new on a revisit, so
 * straight-line (visited-once) code is never widened.
 */
function widenType(oldT: UcodeDataType, newT: UcodeDataType): UcodeDataType {
  if (typesEqual(oldT, newT)) return newT;
  // Union the BASE-collapsed members of both sides: bounded by the finite set of
  // base kinds, and monotone (the result only ever gains base members), so a key
  // widened this way settles within ~(#base-kinds) revisits regardless of how many
  // distinct rich shapes flowed through it.
  return createUnionType([...getUnionTypes(oldT).map(singleTypeToBase), ...getUnionTypes(newT).map(singleTypeToBase)]);
}

/**
 * MONOTONE accumulator for a block's out-env across loop revisits. Two invariants
 * make the fixpoint converge on loops (docs/tc-loop-carried-flow-join.md):
 *
 *  - KEYS NEVER DROP. A key present in the previous out is retained even if this
 *    pass's in-env (an intersection over predecessors) didn't carry it — otherwise
 *    a key flaps present/absent as upstream predecessors get (re)visited, and the
 *    block is re-queued forever. Monotone key growth is bounded by the variable
 *    count. (Sound for the null-tracking consumers: a retained key can only widen
 *    the type — an over-approximation of the values that reach here.)
 *  - CHANGED TYPES WIDEN. A key whose type changed collapses to the base-union of
 *    old ⊔ new (widenType), bounding lattice height so the churn from ever-growing
 *    rich `array<…>` element unions terminates.
 *
 * A key appearing for the FIRST time is kept as-is (its precise type); it only
 * widens once it actually changes on a later revisit.
 */
function widenEnv(oldEnv: FlowEnvironment, newEnv: FlowEnvironment): FlowEnvironment {
  const out = new Map<LValueKey, UcodeDataType>();
  const keys = new Set<LValueKey>([...oldEnv.keys(), ...newEnv.keys()]);
  for (const k of keys) {
    const o = oldEnv.get(k);
    const n = newEnv.get(k);
    if (o === undefined) { if (n !== undefined) out.set(k, n); } // first appearance — keep precise
    else if (n === undefined) out.set(k, o);        // retained (monotone: never drop)
    else if (typesEqual(o, n)) out.set(k, o);
    else out.set(k, widenType(o, n));               // changed — widen to bounded base-union
  }
  return out;
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
    /** C1: guard narrowing applied on conditional edges. Undefined → no guard
     *  narrowing (B-era behavior: assignments only). */
    private readonly edgeGuard?: EdgeGuardFn,
  ) {}

  /** The in-env contribution of one predecessor `p` flowing into `block`: the
   *  predecessor's out-env, narrowed by the guard on the p→block edge (if that
   *  edge is conditional and a guard transfer is present). Returns the predecessor
   *  out-env unchanged for unconditional edges. */
  private edgeInEnv(p: BasicBlock, block: BasicBlock, empty: FlowEnvironment): FlowEnvironment {
    const predOut = this.outEnv.get(p.id) ?? empty;
    if (!this.edgeGuard) return predOut;
    const edge = p.successors.find(e => e.target === block);
    if (!edge?.condition) return predOut;
    const narrowed = new Map(predOut);
    this.edgeGuard(edge.condition, edge.isNegative ?? false, narrowed);
    return narrowed;
  }

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

  /** Block ids reachable from the entry by following successor edges. */
  private reachableBlockIds(): Set<number> {
    const seen = new Set<number>();
    const stack: BasicBlock[] = [this.cfg.entry];
    while (stack.length > 0) {
      const b = stack.pop();
      if (b === undefined) break;
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      for (const edge of b.successors) {
        if (!seen.has(edge.target.id)) stack.push(edge.target);
      }
    }
    return seen;
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

    // Only blocks reachable from the entry participate. An UNREACHABLE block
    // (e.g. the synthetic `after.return` block left dangling past an early
    // `return`) has no predecessors but is NOT the entry — without this it would
    // be wrongly seeded with the parameter env and its stale types would pollute
    // a downstream join (e.g. a guard-narrowed merge would re-widen to `T|unknown`).
    const reachable = this.reachableBlockIds();

    const worklist: BasicBlock[] = this.cfg.blocks.filter(b => reachable.has(b.id));
    const cap = Math.max(64, this.cfg.blocks.length * this.cfg.blocks.length);
    let guard = 0;

    // OPTIMISTIC INITIALIZATION for the intersection meet. joinEnvironments keeps a
    // key only when ALL incoming paths carry it (available-expressions-style meet).
    // The identity for that meet is the UNIVERSAL set, not the empty map — so a
    // predecessor whose out-env has not been computed yet (`outEnv` still the empty
    // placeholder) must NOT constrain the join, or it permanently zeroes the
    // intersection. This is exactly the loop back-edge: on the loop head's first
    // visit the back-edge predecessor (the loop body's tail) is unvisited and empty;
    // treating that empty as a real path drops every loop-carried variable and the
    // fixpoint starves at ∅ (docs/tc-loop-carried-flow-join.md). Skip unvisited
    // predecessors; once the body has run and the tail block is visited, the head is
    // re-queued and joins the real end-of-body state (the loop-carried join). At the
    // final fixpoint every reachable block is visited, so the answer is the true meet.
    const visited = new Set<number>();

    while (worklist.length > 0) {
      if (++guard > cap) break; // widening backstop — should never trigger in practice
      this.iterations = guard;
      const block = worklist.shift();
      if (block === undefined) break;

      // Entry seeds with parameters; every other reachable block joins its
      // REACHABLE, ALREADY-VISITED predecessors (an unreachable pred contributes
      // nothing — and must not, or joinEnvironments' "present on all paths" rule
      // would drop a variable the real paths agree on; an unvisited pred is the
      // back-edge whose end-of-body state is not yet known — see above).
      const joinPreds = block.predecessors.filter(p => reachable.has(p.id) && visited.has(p.id));
      const newIn = block === this.cfg.entry
        ? this.entryEnv // entry: seed with parameters
        : joinEnvironments(joinPreds.map(p => this.edgeInEnv(p, block, empty)));
      this.inEnv.set(block.id, newIn);

      let newOut = this.runBlock(block, newIn);
      const prevOut = this.outEnv.get(block.id) ?? empty;
      // On a REVISIT (loop back-edge re-processing), widen the growing keys so the
      // fixpoint closes in bounded steps instead of churning to the iteration cap.
      if (visited.has(block.id)) newOut = widenEnv(prevOut, newOut);
      const changed = !envsEqual(newOut, prevOut);
      if (changed || !visited.has(block.id)) {
        this.outEnv.set(block.id, newOut);
        visited.add(block.id);
        for (const edge of block.successors) {
          if (reachable.has(edge.target.id) && !worklist.includes(edge.target)) worklist.push(edge.target);
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
    return best ? this.stmtEntry.get(best)?.get(varName) : undefined;
  }
}
