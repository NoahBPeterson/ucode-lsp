// Function-level incremental analysis support.
//
// The semantic analyzer re-processes the whole file on every edit. Type checking dominates
// the cost (~490ms of 540ms on fw4.uc) and is concentrated in function/method BODIES. The
// cheap passes (scope, refs, usage, CFG ~50ms) run fully every time so cross-function state
// stays correct; the EXPENSIVE per-body type checking is skipped for bodies that did not
// change, replaying their cached diagnostics + return type + free-variable usage.
//
// Soundness rests on:
//   1. ENVIRONMENT FINGERPRINT — a hash of the file with every unit body interior blanked.
//      Unchanged ⟺ nothing outside any body changed (signatures, globals, imports, top-level
//      structure). Any change to it discards the whole cache → full re-analysis (always safe).
//   2. PURITY — a body is skippable only if it has no OUTWARD writes (no `this.x=`, no
//      assignment to a non-local name, no member-write to a non-local object). A pure body's
//      only external effects are its return value (cached) and the outer names it reads
//      (cached, replayed as "used"). Everything else is body-local.
//   3. BODY TEXT — a unit is keyed by its exact body text; same text + same fingerprint ⇒
//      identical type-check result, so its cached diagnostics are valid (re-anchored to the
//      body's current offset).
//
// Correctness is continuously checked by tests/test-incremental-analysis.test.js, which
// asserts incremental diagnostics ≡ full-analysis diagnostics across many edit sequences.

import { type ProgramNode, type AstNode, type FunctionDeclarationNode, type FunctionExpressionNode, type ObjectExpressionNode } from '../ast/nodes';
import { forEachAstChild } from '../ast/astChildren';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { UcodeDataType } from './symbolTable';

export interface UnitRange {
  key: string;                 // stable identity within the file (name#ordinal)
  kind: 'function' | 'method'; // function declaration vs object-literal method
  name: string;
  fnNode: AstNode;             // the FunctionDeclaration / FunctionExpression
  bodyStart: number;           // BlockStatement span [start, end)
  bodyEnd: number;
}

export interface RelDiagnostic {
  relStart: number;
  relEnd: number;
  diag: Omit<Diagnostic, 'range'>; // range removed here, recomputed on replay
}

export interface UnitState {
  bodyHash: string;
  cls: BodyClass;               // pure | thisSafe | impure — only the first two are skippable
  returnType: UcodeDataType | undefined; // cached inferred return type
  relDiagnostics: RelDiagnostic[]; // ALL diagnostics inside the body, offsets relative to bodyStart
  thisWrites: Array<[string, UcodeDataType]>; // for a thisSafe body: the `this.<prop> = …` types it sets, replayed on skip so siblings see real types
  sig: string;                  // this unit's externally-visible signature (return type + return shape + this-writes); feeds the semantic fingerprint
}

export interface IncrementalCacheEntry {
  fingerprint: string;     // STRUCTURAL: file with body interiors blanked (out-of-body changes)
  semanticSig: string;     // DERIVED: every unit's return type + this-property writes. If this
                           // changed, a skipped body that reads a sibling's return/this-shape
                           // could be stale → the run must fall back to a full re-analysis.
  units: Map<string, UnitState>;
}

/** djb2 — fast change-detection hash (not cryptographic). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + s.length.toString(36);
}

/** Extract skippable bodies: top-level `function f(){…}` and object-literal methods
 *  `name: function(){…}` of a top-level `let obj = {…}`. */
export function extractUnits(ast: ProgramNode): UnitRange[] {
  const units: UnitRange[] = [];
  let ordinal = 0;
  const add = (kind: 'function' | 'method', name: string, fnNode: AstNode, body: AstNode | undefined) => {
    if (!body || body.type !== 'BlockStatement') return;
    if (typeof body.start !== 'number' || typeof body.end !== 'number') return;
    units.push({ key: `${name}#${ordinal++}`, kind, name, fnNode, bodyStart: body.start, bodyEnd: body.end });
  };
  const addObjectMethods = (obj: ObjectExpressionNode) => {
    for (const prop of obj.properties || []) {
      if (!prop || prop.type !== 'Property') continue;
      const val = prop.value;
      if (val && val.type === 'FunctionExpression') {
        const key = prop.key;
        const nm = (key.type === 'Identifier' ? key.name : undefined)
          ?? (key.type === 'Literal' ? key.value : undefined)
          ?? 'method';
        add('method', String(nm), val, val.body);
      }
    }
  };
  for (const stmt of ast.body || []) {
    if (!stmt) continue;
    if (stmt.type === 'FunctionDeclaration') {
      if (!stmt.forwardDeclaration) add('function', stmt.id?.name ?? 'anon', stmt, stmt.body);
    } else if (stmt.type === 'VariableDeclaration') {
      // `let/const obj = { m: function(){…}, … };`
      for (const decl of stmt.declarations || []) {
        const init = decl.init;
        if (init && init.type === 'ObjectExpression') addObjectMethods(init);
      }
    } else if (stmt.type === 'ReturnStatement') {
      // Module-return pattern: `… ; return { method: function(){…}, … };` (firewall4 fw4.uc).
      const arg = stmt.argument;
      if (arg && arg.type === 'ObjectExpression') addObjectMethods(arg);
    } else if (stmt.type === 'ExpressionStatement') {
      // `export default { … }` lowers to an expression in some shapes; also a bare object expr.
      const expr = stmt.expression;
      if (expr && expr.type === 'ObjectExpression') addObjectMethods(expr);
    }
  }
  return units;
}

/** File text with every unit body INTERIOR blanked → unchanged unless something outside a
 *  body changed. */
export function computeFingerprint(text: string, units: UnitRange[]): string {
  if (units.length === 0) return hashString(text);
  const sorted = [...units].sort((a, b) => a.bodyStart - b.bodyStart);
  let out = '';
  let pos = 0;
  for (const u of sorted) {
    const interiorStart = u.bodyStart + 1;
    const interiorEnd = Math.max(interiorStart, u.bodyEnd - 1);
    if (interiorStart < pos) continue;
    out += text.slice(pos, interiorStart);
    pos = interiorEnd;
  }
  out += text.slice(pos);
  return hashString(out);
}

export function bodyHashOf(text: string, u: UnitRange): string {
  return hashString(text.slice(u.bodyStart, u.bodyEnd));
}


/** A body is PURE (skippable) iff it performs no write whose target escapes the function:
 *  no `this.x=`, no assignment/update/delete to a name not declared within the function, and
 *  no member-write to a non-local object. Conservative: any uncertainty ⇒ impure. */
/** Body classification for incremental skipping:
 *   'pure'     — no outward writes; skippable, no replay needed.
 *   'thisSafe' — the ONLY outward writes are `this.<member> = …`; skippable IF we replay the
 *                cached `this`-property writes (so siblings still see real types).
 *   'impure'   — writes a global / outer object / implicit global; re-analyzed in full.
 */
export type BodyClass = 'pure' | 'thisSafe' | 'impure';

export function classifyBody(u: UnitRange): BodyClass {
  const fn: FunctionDeclarationNode | FunctionExpressionNode | null =
    (u.fnNode.type === 'FunctionDeclaration' || u.fnNode.type === 'FunctionExpression') ? u.fnNode : null;
  if (!fn) return 'pure'; // extractUnits only produces function nodes; match the historical no-op result
  // Only methods (which have a `this`) can be thisSafe; a top-level function writing `this`
  // is meaningless, so treat any non-local write there as impure.
  const allowThis = u.kind === 'method';
  const local = new Set<string>();
  // params of THIS function
  for (const p of fn.params ?? []) if (p?.type === 'Identifier') local.add(p.name);
  if (fn.restParam?.name) local.add(fn.restParam.name);
  // all let/const/param/nested-fn names declared anywhere inside the body
  const collectLocals = (n: AstNode | null | undefined): void => {
    if (!n) return;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') local.add(n.id.name);
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') {
      if (n.id?.name) local.add(n.id.name);
      for (const p of n.params ?? []) if (p?.type === 'Identifier') local.add(p.name);
      if (n.restParam?.name) local.add(n.restParam.name);
    } else if (n.type === 'ArrowFunctionExpression') {
      for (const p of n.params ?? []) if (p?.type === 'Identifier') local.add(p.name);
      if (n.restParam?.name) local.add(n.restParam.name);
    }
    if (n.type === 'ForInStatement' && n.left.type === 'Identifier') local.add(n.left.name);
    forEachAstChild(n, collectLocals);
  };
  collectLocals(fn.body);

  // root of an assignment/delete target: a name, the marker 'this', or null (other → impure)
  const rootName = (t: AstNode | null | undefined): string | null => {
    if (!t) return null;
    if (t.type === 'Identifier') return t.name;
    if (t.type === 'ThisExpression') return ' this';
    if (t.type === 'MemberExpression') return rootName(t.object);
    return null; // CallExpression base, etc.
  };

  let cls: BodyClass = 'pure';
  const note = (root: string | null) => {
    if (root !== null && local.has(root)) return;        // local write → fine
    if (root === ' this' && allowThis) { if (cls === 'pure') cls = 'thisSafe'; return; }
    cls = 'impure';
  };
  const walk = (n: AstNode | null | undefined): void => {
    if (cls === 'impure' || !n) return;
    if (n.type === 'AssignmentExpression') note(rootName(n.left));
    else if (n.type === 'UnaryExpression' && (n.operator === '++' || n.operator === '--')) note(rootName(n.argument));
    else if (n.type === 'DeleteExpression') note(rootName(n.argument));
    forEachAstChild(n, walk);
  };
  walk(fn.body);
  return cls;
}
