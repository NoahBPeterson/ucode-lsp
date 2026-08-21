/**
 * ucode's proto() mechanism, modeled ONCE (docs/prototypes-as-a-first-class-concept.md).
 *
 * proto() is ucode's class system — there is no `class` keyword. The idiom:
 *
 *     const wdev_proto = { get_name: function() { … }, … };
 *     function wdev_new(cfg) { return proto({ cfg }, wdev_proto); }
 *
 * Runtime rules (types.c/lib.c, verified LIVE on owrt-main 2026-08-14):
 *   - `proto(v, P)` returns v itself with prototype P attached; type(v) is
 *     UNCHANGED — an array stays an array, and methods, `this`, and numeric
 *     indexing all work at once.
 *   - member lookup (ucv_key_get) walks the whole chain and skips non-object
 *     levels; OWN members shadow prototype members.
 *   - only arrays and objects can carry a prototype (ucv_prototype_set), and
 *     the prototype itself must be an object — scalars never have members.
 *   - a second `proto(v, P2)` REPLACES the prototype; it does not merge.
 *   - one-argument `proto(v)` READS the prototype instead of setting it.
 *
 * This module holds the pure AST-side helpers. The semantic analyzer stamps the
 * merged member shape onto the binding's symbol (the symbol table is the sole
 * type source for hover/completion), and the type checker's effectiveMembers /
 * jsonSourceReadability read the same stamped maps — one model, every consumer.
 */

import type { AstNode, ObjectExpressionNode } from '../ast/nodes';
import { astChildren, walkAst } from '../ast/astChildren';
import { UcodeType } from './symbolTable';

/** The two operands of a prototype-ATTACHING call `proto(V, P)`. The 1-arg
 *  form reads the prototype and is deliberately not matched. */
export interface ProtoCallParts {
  value: AstNode;
  protoExpr: AstNode;
}

/** Match `proto(V, P)` — a direct call to the (unshadowed-by-convention)
 *  `proto` builtin with both operands present. */
export function asProtoCall(node: AstNode | null | undefined): ProtoCallParts | null {
  if (!node || node.type !== 'CallExpression') return null;
  if (node.callee.type !== 'Identifier' || node.callee.name !== 'proto') return null;
  const value = node.arguments[0];
  const protoExpr = node.arguments[1];
  if (!value || !protoExpr) return null;
  return { value, protoExpr };
}

/**
 * Every prototype OBJECT LITERAL in the file, mapped to the instance (V) nodes
 * attached to it via `proto(V, P)`. P is matched either inline (`proto(v, {…})`)
 * or through a single `let/const P = {…}` declarator; a name declared more than
 * once with an object-literal initializer is ambiguous and skipped.
 *
 * Used for `this` typing: inside a method of a literal that appears here,
 * `this` is the INSTANCE (V), not the prototype table.
 */
export function collectPrototypeInstances(root: AstNode): Map<ObjectExpressionNode, AstNode[]> {
  const out = new Map<ObjectExpressionNode, AstNode[]>();
  const instancesByName = new Map<string, AstNode[]>();

  walkAst(root, (n) => {
    const pc = asProtoCall(n);
    if (!pc) return;
    if (pc.protoExpr.type === 'ObjectExpression') {
      const list = out.get(pc.protoExpr) ?? [];
      list.push(pc.value);
      out.set(pc.protoExpr, list);
    } else if (pc.protoExpr.type === 'Identifier') {
      const list = instancesByName.get(pc.protoExpr.name) ?? [];
      list.push(pc.value);
      instancesByName.set(pc.protoExpr.name, list);
    }
  });

  if (instancesByName.size > 0) {
    // Resolve each referenced prototype NAME to its object-literal declarator.
    const literalByName = new Map<string, ObjectExpressionNode | 'ambiguous'>();
    walkAst(root, (n) => {
      if (n.type !== 'VariableDeclarator' || !n.init) return;
      if (!instancesByName.has(n.id.name)) return;
      // `let P = {…}` — or `let P = proto({…}, base)`, where the METHOD TABLE is
      // the first operand (a chained prototype); unwrap to that literal.
      const init = asProtoCall(n.init)?.value ?? n.init;
      if (init.type !== 'ObjectExpression') return;
      literalByName.set(n.id.name, literalByName.has(n.id.name) ? 'ambiguous' : init);
    });
    for (const [name, instances] of instancesByName) {
      const lit = literalByName.get(name);
      if (lit === undefined || lit === 'ambiguous') continue;
      const list = out.get(lit) ?? [];
      list.push(...instances);
      out.set(lit, list);
    }
  }

  return out;
}

/**
 * Free functions used as prototype METHODS by name reference — the wifi-scripts
 * idiom, where methods are top-level declarations collected into the table:
 *
 *     function setup() { if (this.state != "up") … }
 *     const wdev_proto = { update, destroy, setup, … };
 *
 * Maps each referenced function NAME to the prototype literals that carry it,
 * so the analyzer can type `this` inside those declarations as the instance.
 * Only literals that actually have instances (per collectPrototypeInstances)
 * are consulted — a plain namespace object does not re-type `this`.
 */
export function collectPrototypeMethodFunctions(
  instances: Map<ObjectExpressionNode, AstNode[]>,
): Map<string, ObjectExpressionNode[]> {
  const out = new Map<string, ObjectExpressionNode[]>();
  for (const lit of instances.keys()) {
    for (const prop of lit.properties) {
      if (prop.type !== 'Property' || prop.computed) continue;
      if (prop.value.type !== 'Identifier') continue; // shorthand or `key: fnName`
      const list = out.get(prop.value.name) ?? [];
      list.push(lit);
      out.set(prop.value.name, list);
    }
  }
  return out;
}

/**
 * The initializer of the `let/const <name> = …` declarator VISIBLE at `refPos`,
 * resolved scope-aware from the AST alone: only declarators whose enclosing
 * function contains `refPos` (top-level counts as the whole file) and which
 * precede it are candidates; the innermost scope wins, then the nearest
 * preceding. AST-based on purpose — the consumer resolves instance identifiers
 * while visiting the PROTOTYPE literal, before the instance's (often
 * function-local, later-in-file) declarator exists in the symbol table.
 */
export function declaratorInitNear(name: string, refPos: number, root: AstNode): AstNode | null {
  interface Candidate { init: AstNode; fnStart: number; fnEnd: number; declStart: number }
  const candidates: Candidate[] = [];
  const fnStack: AstNode[] = [];
  const walk = (n: AstNode): void => {
    const isFn = n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
    if (isFn) fnStack.push(n);
    if (n.type === 'VariableDeclarator' && n.id.name === name && n.init) {
      const fn = fnStack[fnStack.length - 1];
      candidates.push({
        init: n.init,
        fnStart: fn ? fn.start : 0,
        fnEnd: fn ? fn.end : Number.MAX_SAFE_INTEGER,
        declStart: n.start,
      });
    }
    for (const c of astChildren(n)) walk(c);
    if (isFn) fnStack.pop();
  };
  walk(root);
  const visible = candidates.filter(c => c.declStart < refPos && refPos >= c.fnStart && refPos <= c.fnEnd);
  if (visible.length === 0) return null;
  visible.sort((a, b) => (a.fnEnd - a.fnStart) - (b.fnEnd - b.fnStart) || b.declStart - a.declStart);
  const best = visible[0];
  return best ? best.init : null;
}

/** The runtime base type of a value used as `proto(V, P)`'s first operand —
 *  `proto` returns V unchanged, so this is the instance's type. Identifiers
 *  resolve through their (unique) declarator's initializer; anything the AST
 *  cannot prove returns null. */
export function instanceBaseType(node: AstNode, root: AstNode): UcodeType.OBJECT | UcodeType.ARRAY | null {
  if (node.type === 'ObjectExpression') return UcodeType.OBJECT;
  if (node.type === 'ArrayExpression') return UcodeType.ARRAY;
  const pc = asProtoCall(node);
  if (pc) return instanceBaseType(pc.value, root); // proto(proto(v, A), B) chains
  if (node.type === 'Identifier') {
    let init: AstNode | null = null;
    let count = 0;
    walkAst(root, (n) => {
      if (n.type === 'VariableDeclarator' && n.id.name === node.name && n.init) {
        init = n.init;
        count++;
      }
    });
    if (count === 1 && init) return instanceBaseType(init, root);
  }
  return null;
}

/** One detected prototype cycle: the proto() calls whose edges close it, in
 *  chain order, with display names for the message (`A → B → A`), the
 *  canonical node keys (see protoOperandKey), and each edge's VALUE expression
 *  (for resolving the participant tables' member sets). */
export interface ProtoCycle {
  calls: AstNode[];
  names: string[];
  keys: string[];
  valueNodes: AstNode[];
  /** The ρ-shape tails: every node whose chain runs INTO this cycle without
   *  being on it (a → b → c → d, cycle d…g). A missing-member read on a tail
   *  node walks the tail and then loops forever, exactly like a read on a
   *  cycle member — container-proven. Each entry carries the PATH from that
   *  node to the cycle (exclusive): its value expressions (for member-set
   *  proofs) and the proto() calls (for execution-certainty checks). */
  tails: Array<{ key: string; name: string; valueNodes: AstNode[]; calls: AstNode[] }>;
}

/** Canonical graph key for a proto() operand: identifiers by NAME (the
 *  `*_proto` idiom is module-level; block-scoped shadowing is not modeled),
 *  literals by position, nested proto() calls by their first operand. Null for
 *  anything unresolvable (a call result, a member expression). */
export function protoOperandKey(expr: AstNode): string | null {
  const pc = asProtoCall(expr);
  if (pc) return protoOperandKey(pc.value); // proto() returns its first operand
  if (expr.type === 'Identifier') return `id:${expr.name}`;
  if (expr.type === 'ObjectExpression' || expr.type === 'ArrayExpression') return `lit:${expr.start}`;
  return null;
}

/** The literal's own member names — or null when the shape is NOT fully
 *  static (a computed key, a spread, a non-name key), i.e. when nothing may be
 *  PROVEN about members that are absent. */
export function staticLiteralKeys(lit: ObjectExpressionNode): string[] | null {
  const out: string[] = [];
  for (const prop of lit.properties) {
    if (prop.type !== 'Property' || prop.computed) return null;
    if (prop.key.type === 'Identifier') out.push(prop.key.name);
    else if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') out.push(prop.key.value);
    else return null;
  }
  return out;
}

/**
 * Cycles in the file's prototype graph. Each `proto(V, P)` is an edge V → P;
 * a LATER call on the same V replaces the earlier edge (runtime REPLACE
 * semantics), so detection runs on the final state — a transient cycle that a
 * later re-parent breaks is not flagged. Identifiers key by name (the
 * `*_proto` idiom is module-level; block-scoped shadowing is not modeled),
 * literals by position.
 *
 * Why this is worth a diagnostic: ucv_key_get walks `proto->proto` with NO
 * cycle guard, and ucv_prototype_set accepts cycles without error. A present
 * member terminates the walk at its first hit, so a cyclic program can run
 * correctly until the first read of a MISSING member — which then loops
 * forever at 100% CPU (container-proven 2026-08-15, twice, with a hang-free
 * control). See docs/cyclic-proto-chain-hang.md.
 */
export function detectProtoCycles(root: AstNode): ProtoCycle[] {
  const keyOf = protoOperandKey;
  const nameOf = (expr: AstNode): string => {
    const pc = asProtoCall(expr);
    if (pc) return nameOf(pc.value);
    if (expr.type === 'Identifier') return expr.name;
    return expr.type === 'ArrayExpression' ? '[…]' : '{…}';
  };

  // Final edge per source node (last proto() call wins — REPLACE semantics).
  const edges = new Map<string, { target: string; call: AstNode; name: string; valueNode: AstNode }>();
  walkAst(root, (n) => {
    const pc = asProtoCall(n);
    if (!pc) return;
    const src = keyOf(pc.value);
    const dst = keyOf(pc.protoExpr);
    if (src === null || dst === null) return;
    edges.set(src, { target: dst, call: n, name: nameOf(pc.value), valueNode: pc.value });
  });

  // Each node has at most one outgoing edge, so a chain walk with a per-walk
  // index finds every cycle; nodes already claimed by a cycle are skipped.
  const cycles: ProtoCycle[] = [];
  const claimed = new Set<string>();
  for (const start of edges.keys()) {
    if (claimed.has(start)) continue;
    const index = new Map<string, number>();
    const path: string[] = [];
    let cur: string | undefined = start;
    while (cur !== undefined && edges.has(cur) && !index.has(cur)) {
      index.set(cur, path.length);
      path.push(cur);
      cur = edges.get(cur)?.target;
    }
    if (cur === undefined || !index.has(cur)) continue; // ran off the chain — no cycle
    const at = index.get(cur);
    if (at === undefined) continue;
    const cycleKeys = path.slice(at);
    if (cycleKeys.some((k) => claimed.has(k))) continue; // already reported via another entry
    for (const k of cycleKeys) claimed.add(k);
    const members = cycleKeys
      .map((k) => edges.get(k))
      .filter((e): e is { target: string; call: AstNode; name: string; valueNode: AstNode } => e !== undefined);
    cycles.push({
      calls: members.map((e) => e.call),
      names: members.map((e) => e.name),
      keys: [...cycleKeys],
      valueNodes: members.map((e) => e.valueNode),
      tails: [],
    });
  }

  // ρ-shape tails: with out-degree ≤ 1 (one prototype slot per value), every
  // chain ends at a dead end or in exactly one cycle — two cycles can never
  // share a node. Walk each non-cycle source to whichever cycle it reaches.
  if (cycles.length > 0) {
    const cycleOfKey = new Map<string, number>();
    cycles.forEach((c, i) => { for (const k of c.keys) cycleOfKey.set(k, i); });
    for (const start of edges.keys()) {
      if (cycleOfKey.has(start)) continue;
      const pathKeys: string[] = [];
      const seen = new Set<string>();
      let cur: string | undefined = start;
      let reached: number | undefined;
      while (cur !== undefined && edges.has(cur) && !seen.has(cur)) {
        const hit = cycleOfKey.get(cur);
        if (hit !== undefined) { reached = hit; break; }
        seen.add(cur);
        pathKeys.push(cur);
        cur = edges.get(cur)?.target;
      }
      if (cur !== undefined && reached === undefined) reached = cycleOfKey.get(cur);
      if (reached === undefined) continue; // dead-ends before any cycle
      const cycle = cycles[reached];
      const firstEdge = edges.get(start);
      if (!cycle || !firstEdge) continue;
      const pathEdges = pathKeys
        .map((k) => edges.get(k))
        .filter((e): e is { target: string; call: AstNode; name: string; valueNode: AstNode } => e !== undefined);
      cycle.tails.push({
        key: start,
        name: firstEdge.name,
        valueNodes: pathEdges.map((e) => e.valueNode),
        calls: pathEdges.map((e) => e.call),
      });
    }
  }
  return cycles;
}
