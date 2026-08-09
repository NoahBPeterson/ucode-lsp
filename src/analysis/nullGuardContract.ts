/**
 * Null-guard contract inference (docs/error-guard-null-narrowing.md, phase 1).
 *
 * The target shape is luci.podman_validate's require_param:
 *
 *     export function require_param(name, value) {
 *         if (value == null || value === ''
 *             || (type(value) === 'object' && length(keys(value)) === 0))
 *             return `Missing required parameter: ${name}`;
 *     };
 *
 * Whenever `value` is null the guard test is true (the `value == null` arm short-
 * circuits the `||`) and the function returns a provably TRUTHY value; every other
 * completion returns null/implicitly. Contract: A FALSY RESULT PROVES THE FLAGGED
 * ARGUMENT WAS NON-NULL. This module infers, per function AST, which parameter
 * indices carry that contract.
 *
 * A parameter p is flagged only when all of:
 *   - some top-level `if (T) <always-return-truthy>` (no else) has a top-level
 *     ||-arm of T that is a null test of p (`p == null`, `p === null`, `null == p`,
 *     `!p`) — so p null ⇒ T true ⇒ the truthy return runs;
 *   - no EARLIER top-level statement contains an own-function return that is not
 *     provably truthy: a falsy-capable earlier return could preempt the guard and
 *     hand the caller a falsy result while p is still null. Scanning stops at the
 *     first such statement (later guards are unproven), keeping earlier flags.
 *
 * Deliberate non-matches (the survey's ❌ rows): content validators
 * (`validate_int` tests `int(value) !== value`, no null arm → nothing flagged),
 * and functions whose truthy return is nested under extra conditions. Paths that
 * DIVERGE (die()/exit/throw) instead of returning are harmless — they never
 * produce a falsy result — and falling off the end (implicit null) only happens
 * when the guard test was false, i.e. p was non-null.
 */

import type { AstNode, BinaryExpressionNode, IdentifierNode, LiteralNode, TemplateLiteralNode, UnaryExpressionNode } from '../ast/nodes';

const contractCache = new WeakMap<AstNode, number[]>();

/** Parameter indices of `funcNode` whose null-guard contract holds (see module
 *  doc). Cached per AST node; a re-parse produces fresh nodes, so entries age out
 *  with their tree. */
export function inferNullGuardParams(funcNode: AstNode): number[] {
  const hit = contractCache.get(funcNode);
  if (hit) return hit;
  const result = computeNullGuardParams(funcNode);
  contractCache.set(funcNode, result);
  return result;
}

function computeNullGuardParams(funcNode: AstNode): number[] {
  const fn = funcNode as AstNode & {
    forwardDeclaration?: boolean;
    params?: Array<{ name: string }>;
    body?: AstNode & { body?: AstNode[] };
  };
  if (fn.forwardDeclaration || !fn.params || fn.params.length === 0) return [];
  if (!fn.body || fn.body.type !== 'BlockStatement') return [];
  const indexByName = new Map<string, number>(fn.params.map((p, i) => [p.name, i]));

  const flagged = new Set<number>();
  for (const stmt of fn.body.body ?? []) {
    const s = stmt as AstNode & { alternate?: AstNode; consequent?: AstNode; test?: AstNode };
    if (s.type === 'IfStatement' && !s.alternate && s.consequent && s.test
        && alwaysReturnsTruthy(s.consequent)) {
      for (const arm of flattenOr(s.test)) {
        const name = nullTestedIdentifier(arm);
        const idx = name !== null ? indexByName.get(name) : undefined;
        if (idx !== undefined) flagged.add(idx);
      }
      continue; // every return in this statement is provably truthy — can't preempt later guards
    }
    // Any other statement that can hand back a falsy/unknown value ends the
    // provable prefix; guards after it are reached only on unknowable paths.
    if (containsFalsyCapableReturn(stmt)) break;
  }
  return [...flagged].sort((a, b) => a - b);
}

/** Top-level `||` arms of a test expression (a non-`||` node is its own arm). */
function flattenOr(node: AstNode): AstNode[] {
  if (node.type === 'BinaryExpression' && (node as BinaryExpressionNode).operator === '||') {
    const b = node as BinaryExpressionNode;
    return [...flattenOr(b.left), ...flattenOr(b.right)];
  }
  return [node];
}

/** The parameter name this arm null-tests, or null: `p == null`, `p === null`,
 *  `null == p`, `!p`. (`!p` over-covers '' and 0, which is fine — null still
 *  implies it.) A bare `p` arm is a TRUTHINESS test — the opposite — never a match. */
function nullTestedIdentifier(arm: AstNode): string | null {
  if (arm.type === 'BinaryExpression') {
    const b = arm as BinaryExpressionNode;
    if (b.operator !== '==' && b.operator !== '===') return null;
    if (b.left.type === 'Identifier' && isNullLiteral(b.right)) return (b.left as IdentifierNode).name;
    if (b.right.type === 'Identifier' && isNullLiteral(b.left)) return (b.right as IdentifierNode).name;
    return null;
  }
  if (arm.type === 'UnaryExpression') {
    const u = arm as UnaryExpressionNode;
    if (u.operator === '!' && u.argument?.type === 'Identifier') return (u.argument as IdentifierNode).name;
  }
  return null;
}

function isNullLiteral(node: AstNode): boolean {
  return node.type === 'Literal'
    && ((node as LiteralNode).value === null || (node as LiteralNode).literalType === 'null');
}

/** Does executing this consequent ALWAYS end in a provably-truthy return?
 *  A bare `return <truthy>` qualifies; a block qualifies when its last statement
 *  is such a return and no other return hides in the subtree (a nested
 *  conditional return could let execution fall past the block). */
function alwaysReturnsTruthy(node: AstNode): boolean {
  if (node.type === 'ReturnStatement') {
    const arg = (node as AstNode & { argument?: AstNode }).argument;
    return !!arg && isProvablyTruthy(arg);
  }
  if (node.type === 'BlockStatement') {
    const stmts = (node as AstNode & { body?: AstNode[] }).body ?? [];
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1]!;
    if (last.type !== 'ReturnStatement') return false;
    let returns = 0;
    let allTruthy = true;
    walkOwn(node, (n) => {
      if (n.type === 'ReturnStatement') {
        returns++;
        const arg = (n as AstNode & { argument?: AstNode }).argument;
        if (!arg || !isProvablyTruthy(arg)) allTruthy = false;
      }
    });
    return returns >= 1 && allTruthy;
  }
  return false;
}

/** Truthiness provable from the expression alone. Objects and arrays are ALWAYS
 *  truthy in ucode (even empty ones); a template literal is truthy when any
 *  literal chunk is non-empty (interpolations can't empty it back out). */
function isProvablyTruthy(expr: AstNode): boolean {
  if (expr.type === 'Literal') {
    const lit = expr as LiteralNode;
    if (typeof lit.value === 'string') return lit.value.length > 0;
    if (typeof lit.value === 'number') return lit.value !== 0;
    return lit.value === true;
  }
  if (expr.type === 'TemplateLiteral') {
    return (expr as TemplateLiteralNode).quasis?.some(q => (q.value?.cooked ?? q.value?.raw ?? '').length > 0) ?? false;
  }
  return expr.type === 'ObjectExpression' || expr.type === 'ArrayExpression';
}

/** Does this statement contain an own-function return (nested functions excluded)
 *  whose value is not provably truthy — i.e. one that could hand the caller a
 *  falsy result? */
function containsFalsyCapableReturn(stmt: AstNode): boolean {
  let found = false;
  walkOwn(stmt, (n) => {
    if (n.type === 'ReturnStatement') {
      const arg = (n as AstNode & { argument?: AstNode }).argument;
      if (!arg || !isProvablyTruthy(arg)) found = true;
    }
  });
  return found;
}

/** Walk a subtree, skipping nested function bodies (their returns are their own). */
function walkOwn(node: AstNode, visit: (n: AstNode) => void): void {
  const stack: AstNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (!n || typeof n !== 'object' || typeof (n as { type?: unknown }).type !== 'string') continue;
    if (n !== node && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) continue;
    visit(n);
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'leadingJsDoc' || key.startsWith('_')) continue;
      const v = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(v)) { for (const it of v) if (it && typeof it === 'object') stack.push(it as AstNode); }
      else if (v && typeof v === 'object') stack.push(v as AstNode);
    }
  }
}
