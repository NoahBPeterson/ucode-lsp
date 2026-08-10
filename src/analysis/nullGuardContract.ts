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

import type { AstNode } from '../ast/nodes';
import { astChildren } from '../ast/astChildren';

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
  if (funcNode.type !== 'FunctionDeclaration' && funcNode.type !== 'FunctionExpression'
      && funcNode.type !== 'ArrowFunctionExpression') return [];
  if (funcNode.type === 'FunctionDeclaration' && funcNode.forwardDeclaration) return [];
  if (funcNode.params.length === 0) return [];
  const body = funcNode.body;
  if (!body || body.type !== 'BlockStatement') return [];
  const indexByName = new Map<string, number>(funcNode.params.map((p, i) => [p.name, i]));

  const flagged = new Set<number>();
  for (const stmt of body.body ?? []) {
    if (stmt.type === 'IfStatement' && !stmt.alternate && stmt.consequent && stmt.test
        && alwaysReturnsTruthy(stmt.consequent)) {
      for (const arm of flattenOr(stmt.test)) {
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
  if (node.type === 'BinaryExpression' && node.operator === '||') {
    return [...flattenOr(node.left), ...flattenOr(node.right)];
  }
  return [node];
}

/** The parameter name this arm null-tests, or null: `p == null`, `p === null`,
 *  `null == p`, `!p`. (`!p` over-covers '' and 0, which is fine — null still
 *  implies it.) A bare `p` arm is a TRUTHINESS test — the opposite — never a match. */
function nullTestedIdentifier(arm: AstNode): string | null {
  if (arm.type === 'BinaryExpression') {
    if (arm.operator !== '==' && arm.operator !== '===') return null;
    if (arm.left.type === 'Identifier' && isNullLiteral(arm.right)) return arm.left.name;
    if (arm.right.type === 'Identifier' && isNullLiteral(arm.left)) return arm.right.name;
    return null;
  }
  if (arm.type === 'UnaryExpression') {
    if (arm.operator === '!' && arm.argument?.type === 'Identifier') return arm.argument.name;
  }
  return null;
}

function isNullLiteral(node: AstNode): boolean {
  return node.type === 'Literal'
    && (node.value === null || node.literalType === 'null');
}

/** Does executing this consequent ALWAYS end in a provably-truthy return?
 *  A bare `return <truthy>` qualifies; a block qualifies when its last statement
 *  is such a return and no other return hides in the subtree (a nested
 *  conditional return could let execution fall past the block). */
function alwaysReturnsTruthy(node: AstNode): boolean {
  if (node.type === 'ReturnStatement') {
    const arg = node.argument;
    return !!arg && isProvablyTruthy(arg);
  }
  if (node.type === 'BlockStatement') {
    const stmts = node.body ?? [];
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1]!;
    if (last.type !== 'ReturnStatement') return false;
    let returns = 0;
    let allTruthy = true;
    walkOwn(node, (n) => {
      if (n.type === 'ReturnStatement') {
        returns++;
        const arg = n.argument;
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
    if (typeof expr.value === 'string') return expr.value.length > 0;
    if (typeof expr.value === 'number') return expr.value !== 0;
    return expr.value === true;
  }
  if (expr.type === 'TemplateLiteral') {
    return expr.quasis?.some(q => (q.value?.cooked ?? q.value?.raw ?? '').length > 0) ?? false;
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
      const arg = n.argument;
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
    if (n !== node && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) continue;
    visit(n);
    for (const child of astChildren(n)) stack.push(child);
  }
}
