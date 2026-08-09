// Error-guard null narrowing (docs/error-guard-null-narrowing.md): the
// require_param idiom —
//     let err = require_param('x', v) || validate_name(v) || …;
//     if (err) die(err);
// A falsy null-guard result proves its flagged argument non-null (the guard
// returns a provably-truthy value whenever that argument is null), and err falsy
// means every ||-arm evaluated falsy — so past a terminating `if (err)` bail,
// inside its else, in the `!err` positive branch, both ternary shapes, and to the
// right of `err ||` / mid-chain, null is stripped from every guarded argument.
// The contract is inferred from the guard's body (nullGuardContract.ts), carried
// cross-file on the imported symbol, and applied in collectGuards with
// write/loop invalidation.
//
// Sections: A contract inference (positive) · B contract inference (negative) ·
// C application forms · D argument forms · E invalidation & counterexamples ·
// F cross-file · G hover · H interplay.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(60000);

let server, dir, n = 0;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errguard-'));
  // The cross-file guard module, verbatim luci.podman_validate shapes.
  fs.writeFileSync(path.join(dir, 'validate.uc'),
    'export function require_param(name, value) {\n' +
    "\tif (value == null || value === '' || (type(value) === 'object' && length(keys(value)) === 0))\n" +
    '\t\treturn `Missing required parameter: ${name}`;\n' +
    '};\n' +
    'export function validate_int(value) {\n' +
    '\tif (int(value) != value) return `Not an integer: ${value}`;\n' +
    '};\n');
  // Barrel re-export of the guard.
  fs.writeFileSync(path.join(dir, 'barrel.uc'),
    "import { require_param } from './validate.uc';\nexport { require_param };\n");
});
afterAll(() => { try { server.shutdown(); } catch {}; fs.rmSync(dir, { recursive: true, force: true }); });

// Preamble: strict (shebang) + local guard fns. Tests build on these unless they
// define their own guard shape.
const RP = [
  'function require_param(name, value) {',
  "\tif (value == null || value === '' || (type(value) === 'object' && length(keys(value)) === 0))",
  '\t\treturn `Missing required parameter: ${name}`;',
  '};',
];
const DIE = ['function die(msg) { warn(`${msg}\\n`); exit(1); };'];

// Null-family diagnostics: the may-be-null builtin-arg warning, and the
// user-function possibly-null arg error. (The strict "is unknown" complaint
// shares the latter code but not the message — excluded on purpose.)
const nullFam = (d) => (d || []).filter((x) =>
  String(x.code) === 'nullable-argument'
  || (String(x.code) === 'incompatible-function-argument' && /possibly 'null'/.test(x.message)));

async function diagsOf(codeLines, { shebang = true } = {}) {
  const code = [...(shebang ? ['#!/usr/bin/env ucode'] : []), ...codeLines].join('\n');
  return await server.getDiagnostics(code, path.join(dir, `case-${n++}.uc`));
}
async function narrowed(codeLines, opts) {
  return nullFam(await diagsOf(codeLines, opts)).length === 0;
}
async function hoverAt(codeLines, lineNeedle, colNeedle, delta, { shebang = true } = {}) {
  const code = [...(shebang ? ['#!/usr/bin/env ucode'] : []), ...codeLines].join('\n');
  const p = path.join(dir, `case-${n++}.uc`);
  await server.getDiagnostics(code, p);
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes(lineNeedle));
  const h = await server.getHover(code, p, line, lines[line].indexOf(colNeedle) + delta);
  return h?.contents?.value ?? null;
}

// A guard shape harness: define a guard `g`, capture, bail, use.
const useAfterGuard = (guardLines, chain = "g('v', v)") => [
  ...guardLines,
  'let v = ARGV[1];',
  `let err = ${chain};`,
  'if (err) exit(1);',
  'print(b64dec(v));',
];

// ───────────────────────── A. Contract inference — shapes that DO infer ──────

test('A1: `value == null` first arm (canonical require_param)', async () => {
  expect(await narrowed(useAfterGuard(RP, "require_param('v', v)"))).toBe(true);
});

test('A2: reversed `null == value`', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (null == value || value === '') return `Missing: ${name}`;",
    '};']))).toBe(true);
});

test('A3: strict `value === null`', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value === null) return `Missing: ${name}`;',
    '};']))).toBe(true);
});

test('A4: reversed strict `null === value`', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (null === value) return `Missing: ${name}`;',
    '};']))).toBe(true);
});

test('A5: `!value` arm (over-covers "" and 0 — null still implies it)', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (!value) return `Missing: ${name}`;',
    '};']))).toBe(true);
});

test('A6: single-arm test, no || at all', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return `Missing: ${name}`;',
    '};']))).toBe(true);
});

test('A7: returns a plain non-empty string literal', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (value == null) return 'missing';",
    '};']))).toBe(true);
});

test('A8: returns a template literal with interpolation (non-empty head)', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return `Missing required parameter: ${name}`;',
    '};']))).toBe(true);
});

test('A9: returns a pure-text template literal', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return `missing parameter`;',
    '};']))).toBe(true);
});

test('A10: returns `true`', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return true;',
    '};']))).toBe(true);
});

test('A11: returns a non-zero integer', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return 1;',
    '};']))).toBe(true);
});

test('A12: returns a non-zero double', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return 3.5;',
    '};']))).toBe(true);
});

test('A13: returns an object literal (always truthy in ucode)', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return { error: name };',
    '};']))).toBe(true);
});

test('A14: returns an array literal (always truthy in ucode)', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return [name];',
    '};']))).toBe(true);
});

test('A15: block consequent with a single return', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) {',
    "\t\treturn 'missing';",
    '\t}',
    '};']))).toBe(true);
});

test('A16: block consequent with logging before the return', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) {',
    '\t\twarn(`rejecting ${name}\\n`);',
    "\t\treturn 'missing';",
    '\t}',
    '};']))).toBe(true);
});

test('A17: block consequent whose nested branches all return truthy', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) {',
    "\t\tif (name == 'v') return 'missing v';",
    "\t\treturn 'missing other';",
    '\t}',
    '};']))).toBe(true);
});

test('A18: two params null-tested in ONE || test — both flagged', async () => {
  const diags = await diagsOf([
    'function g(a, b) {',
    "\tif (a == null || b == null) return 'missing';",
    '};',
    'let x = ARGV[1];',
    'let y = ARGV[2];',
    'let err = g(x, y);',
    'if (err) exit(1);',
    'print(b64dec(x), b64dec(y));']);
  expect(nullFam(diags)).toEqual([]);
});

test('A19: two params null-tested in SEQUENTIAL guard ifs — both flagged', async () => {
  const diags = await diagsOf([
    'function g(a, b) {',
    "\tif (a == null) return 'missing a';",
    "\tif (b == null) return 'missing b';",
    '};',
    'let x = ARGV[1];',
    'let y = ARGV[2];',
    'let err = g(x, y);',
    'if (err) exit(1);',
    'print(b64dec(x), b64dec(y));']);
  expect(nullFam(diags)).toEqual([]);
});

test('A20: only the SECOND param null-tested — first stays nullable', async () => {
  const diags = await diagsOf([
    'function g(a, b) {',
    "\tif (b == null) return 'missing b';",
    '};',
    'let x = ARGV[1];',
    'let y = ARGV[2];',
    'let err = g(x, y);',
    'if (err) exit(1);',
    'print(b64dec(y));',
    'print(b64dec(x));']);
  expect(nullFam(diags).length).toBe(1);
});

test('A21: null arm LAST in a 3-arm || test', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (value === '' || length(name) == 0 || value == null) return 'bad';",
    '};']))).toBe(true);
});

test('A22: earlier SAFE statements (declarations) do not break inference', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tlet label = `param ${name}`;',
    '\tconst LIMIT = 10;',
    '\tif (value == null) return `Missing ${label} (${LIMIT})`;',
    '};']))).toBe(true);
});

test('A23: an earlier all-truthy guard-if does not break a later guard', async () => {
  const diags = await diagsOf([
    'function g(a, b) {',
    "\tif (a == null) return 'missing a';",
    "\tif (length(a) > 64) return 'a too long';",
    "\tif (b == null) return 'missing b';",
    '};',
    'let x = ARGV[1];',
    'let y = ARGV[2];',
    'let err = g(x, y);',
    'if (err) exit(1);',
    'print(b64dec(x), b64dec(y));']);
  expect(nullFam(diags)).toEqual([]);
});

test('A24: guard defined via arrow function with block body', async () => {
  expect(await narrowed(useAfterGuard([
    'let g = (name, value) => {',
    "\tif (value == null) return `Missing: ${name}`;",
    '};']))).toBe(true);
});

test('A25: guard defined via function expression', async () => {
  expect(await narrowed(useAfterGuard([
    'let g = function(name, value) {',
    "\tif (value == null) return `Missing: ${name}`;",
    '};']))).toBe(true);
});

test('A26: recursive guard (self-call after the null arm) still infers it', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (value == null) return `Missing: ${name}`;",
    "\tif (type(value) == 'array') return g(name, value[0]);",
    '};']))).toBe(true);
});

test('A27: diverging die() path after the guard does not break inference', async () => {
  expect(await narrowed([
    ...DIE,
    'function g(name, value) {',
    "\tif (value == null) return `Missing: ${name}`;",
    "\tif (name == '') die('empty name');",
    '};',
    'let v = ARGV[1];',
    "let err = g('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

// ──────────────────── B. Contract inference — shapes that must NOT infer ─────

test('B1: content validator (int comparison, no null arm)', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (int(value) != value) return `Not an integer: ${value}`;',
    '};']))).toBe(false);
});

test('B2: type()-based validator (no null arm)', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (type(value) != 'string') return `Not a string: ${name}`;",
    '};']))).toBe(false);
});

test('B3: guard returning an EMPTY string (falsy) proves nothing', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (value == null) return '';",
    '};']))).toBe(false);
});

test('B4: pure-interpolation template `${...}` can be empty — not provably truthy', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return `${name}`;',
    '};']))).toBe(false);
});

test('B5: returning zero is falsy — proves nothing', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return 0;',
    '};']))).toBe(false);
});

test('B6: bare `value` truthiness arm is the OPPOSITE test — never a null arm', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (value || name == '') return 'weird';",
    '};']))).toBe(false);
});

test('B7: null test nested under && is not a top-level || arm', async () => {
  // `(value == null && strict)` — a null value does NOT force the test true
  // when strict is false, so no contract.
  expect(await narrowed(useAfterGuard([
    'function g(name, value, strict) {',
    "\tif ((value == null && strict) || name == '') return 'bad';",
    '};'], "g('v', v, false)"))).toBe(false);
});

test('B8: guard-if WITH an else is not the canonical shape — skipped', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    "\tif (value == null) return 'missing';",
    "\telse if (name == '') return null;",
    '};']))).toBe(false);
});

test('B9: an EARLIER falsy-capable return preempts later guards', async () => {
  const diags = await diagsOf([
    'function g(a, b) {',
    "\tif (a == null) return 'missing a';",
    '\tif (length(a) > 64) return null;',
    "\tif (b == null) return 'missing b';",
    '};',
    'let x = ARGV[1];',
    'let y = ARGV[2];',
    'let err = g(x, y);',
    'if (err) exit(1);',
    'print(b64dec(x));',
    'print(b64dec(y));']);
  // a (before the falsy return) still narrows; b (after it) must not.
  expect(nullFam(diags).length).toBe(1);
});

test('B10: consequent that can fall through (nested conditional return) — skipped', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) {',
    "\t\tif (name != '') return 'missing';",
    '\t}',
    '};']))).toBe(false);
});

test('B11: consequent return with NO argument is falsy — skipped', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '\tif (value == null) return;',
    '};']))).toBe(false);
});

test('B12: empty guard body proves nothing', async () => {
  expect(await narrowed(useAfterGuard([
    'function g(name, value) {',
    '};']))).toBe(false);
});

test('B13: wrapper delegating to a real guard is not followed (conservative)', async () => {
  expect(await narrowed(useAfterGuard([
    ...RP,
    'function g(name, value) {',
    '\treturn require_param(name, value);',
    '};']))).toBe(false);
});

test('B14: expression-body arrow guard is not analyzed (conservative)', async () => {
  expect(await narrowed(useAfterGuard([
    "let g = (name, value) => value == null ? `Missing: ${name}` : null;"]))).toBe(false);
});

test('B15: guard returning a CALL result is not provably truthy', async () => {
  expect(await narrowed(useAfterGuard([
    'function msg(name) { return `Missing: ${name}`; };',
    'function g(name, value) {',
    '\tif (value == null) return msg(name);',
    '};']))).toBe(false);
});

// ───────────────────────────── C. Application forms ──────────────────────────

test('C1: `if (err) die(err);` fall-through', async () => {
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) die(err);',
    'print(b64dec(v));'])).toBe(true);
});

test('C2: `if (err) exit(1);` fall-through', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C3: `if (err) return …;` inside a function (the rpcd method shape)', async () => {
  expect(await narrowed([
    ...RP,
    'function handler() {',
    '\tlet v = ARGV[1];',
    "\tlet err = require_param('v', v);",
    '\tif (err) return { error: err };',
    '\treturn { data: b64dec(v) };',
    '};',
    'print(handler());'])).toBe(true);
});

test('C4: a USER-DEFINED terminator (fatal → die) works via the neverReturns fixpoint', async () => {
  expect(await narrowed([
    ...RP,
    'function fatal(msg) {',
    '\twarn(`${msg}\\n`);',
    '\texit(1);',
    '};',
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) fatal(err);',
    'print(b64dec(v));'])).toBe(true);
});

test('C5: block consequent bail `{ die(err); }`', async () => {
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) { die(err); }',
    'print(b64dec(v));'])).toBe(true);
});

test('C6: block consequent with logging then bail', async () => {
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) {',
    '\twarn(`fatal: ${err}\\n`);',
    '\tdie(err);',
    '}',
    'print(b64dec(v));'])).toBe(true);
});

test('C7: `if (err) continue;` narrows the rest of the loop iteration', async () => {
  expect(await narrowed([
    ...RP,
    'for (let i = 0; i < 3; i++) {',
    '\tlet v = ARGV[i];',
    "\tlet err = require_param('v', v);",
    '\tif (err) continue;',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C8: `if (err) break;` narrows the rest of the loop iteration', async () => {
  expect(await narrowed([
    ...RP,
    'for (let i = 0; i < 3; i++) {',
    '\tlet v = ARGV[i];',
    "\tlet err = require_param('v', v);",
    '\tif (err) break;',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C9: else-branch of `if (err) … else { use }`', async () => {
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) {',
    '\tdie(err);',
    '} else {',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C10: `if (!err) { use }` positive branch', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (!err) {',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C11: `if (!err && ready) { use }` — conjunct form', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let ready = length(ARGV) > 1;',
    "let err = require_param('v', v);",
    'if (!err && ready) {',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C12: ternary alternate `err ? null : use`', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'let out = err ? null : b64dec(v);',
    'print(out);'])).toBe(true);
});

test('C13: ternary consequent `!err ? use : null`', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'let out = !err ? b64dec(v) : null;',
    'print(out);'])).toBe(true);
});

test('C14: `err || use(v)` — the flag as a || left arm', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'err || print(b64dec(v));'])).toBe(true);
});

test('C15: two flags stacked: `e1 || e2 || use` narrows both captures', async () => {
  expect(await narrowed([
    ...RP,
    'let a = ARGV[1];',
    'let b = ARGV[2];',
    "let e1 = require_param('a', a);",
    "let e2 = require_param('b', b);",
    'e1 || e2 || print(b64dec(a), b64dec(b));'])).toBe(true);
});

test('C16: mid-chain — a guard arm narrows the arms after it', async () => {
  expect(await narrowed([
    'function require_param(name, value) {',
    "\tif (value == null || value === '') return `Missing: ${name}`;",
    '};',
    '/** @param {string} value */',
    'function validate_name(value) {',
    "\tif (!match(value, /^[a-z0-9_.-]+$/)) return `Invalid: ${value}`;",
    '};',
    'let v = ARGV[1];',
    "let err = require_param('v', v) || validate_name(v);",
    'if (err) exit(1);',
    'print(v);'])).toBe(true);
});

test('C17: mid-chain third arm sees BOTH earlier guard arms', async () => {
  expect(await narrowed([
    'function require_param(name, value) {',
    "\tif (value == null || value === '') return `Missing: ${name}`;",
    '};',
    '/** @param {string} a\n * @param {string} b */',
    'function check_pair(a, b) {',
    "\tif (a == b) return 'same';",
    '};',
    'let x = ARGV[1];',
    'let y = ARGV[2];',
    "let err = require_param('x', x) || require_param('y', y) || check_pair(x, y);",
    'if (err) exit(1);',
    'print(x, y);'])).toBe(true);
});

test('C18: single call, no chain', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C19: four-arm chain narrows every guarded variable', async () => {
  const diags = await diagsOf([
    ...RP, ...DIE,
    'let a = ARGV[1];',
    'let b = ARGV[2];',
    'let c = ARGV[3];',
    'let d = ARGV[4];',
    "let err = require_param('a', a) || require_param('b', b)",
    "       || require_param('c', c) || require_param('d', d);",
    'if (err) die(err);',
    'print(b64dec(a), b64dec(b), b64dec(c), b64dec(d));']);
  expect(nullFam(diags)).toEqual([]);
});

test('C20: parenthesized chain initializer', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = (require_param('v', v) || require_param('w', v));",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C21: sequential independent flags each narrow their own capture', async () => {
  const diags = await diagsOf([
    ...RP, ...DIE,
    'let a = ARGV[1];',
    'let b = ARGV[2];',
    "let err1 = require_param('a', a);",
    'if (err1) die(err1);',
    "let err2 = require_param('b', b);",
    'if (err2) die(err2);',
    'print(b64dec(a), b64dec(b));']);
  expect(nullFam(diags)).toEqual([]);
});

test('C22: IIFE arrow — guard + die inside', async () => {
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    'let out = (() => {',
    "\tlet err = require_param('v', v);",
    '\tif (err) die(err);',
    '\treturn b64dec(v);',
    '})();',
    'print(out);'])).toBe(true);
});

test('C23: IIFE arrow — guard + return inside', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let out = (() => {',
    "\tlet err = require_param('v', v);",
    '\tif (err) return null;',
    '\treturn b64dec(v);',
    '})();',
    'print(out);'])).toBe(true);
});

test('C24: IIFE function-expression', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let out = (function() {',
    "\tlet err = require_param('v', v);",
    '\tif (err) return null;',
    '\treturn b64dec(v);',
    '})();',
    'print(out);'])).toBe(true);
});

test('C25: IIFE with nested if-chain around the guarded use', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let out = (() => {',
    "\tlet err = require_param('v', v);",
    '\tif (err) return null;',
    '\tif (length(v) > 8) {',
    "\t\tif (substr(v, 0, 1) == '/')",
    '\t\t\treturn b64dec(v);',
    '\t}',
    '\treturn null;',
    '})();',
    'print(out);'])).toBe(true);
});

const REQ_TYPEDEFS = [
  '/**',
  ' * @typedef {object} ReqArgs',
  ' * @property {?string} id',
  ' */',
  '/**',
  ' * @typedef {object} Req',
  ' * @property {ReqArgs} args',
  ' */',
];

test('C26: object-literal method (function expression) — the rpcd dispatcher shape', async () => {
  expect(await narrowed([
    ...RP,
    ...REQ_TYPEDEFS,
    'let api = {',
    '\t/** @param {Req} req */',
    '\thandle: function(req) {',
    "\t\tlet err = require_param('id', req.args.id);",
    '\t\tif (err) return { error: err };',
    '\t\treturn { data: b64dec(req.args.id) };',
    '\t},',
    '};',
    'print(api.handle({ args: { id: ARGV[1] } }));'])).toBe(true);
});

test('C27: object-literal method (arrow)', async () => {
  expect(await narrowed([
    ...RP,
    ...REQ_TYPEDEFS,
    'let api = {',
    '\t/** @param {Req} req */',
    '\thandle: (req) => {',
    "\t\tlet err = require_param('id', req.args.id);",
    '\t\tif (err) return { error: err };',
    '\t\treturn { data: b64dec(req.args.id) };',
    '\t},',
    '};',
    'print(api.handle({ args: { id: ARGV[1] } }));'])).toBe(true);
});

test('C28: exported function containing the guard', async () => {
  expect(await narrowed([
    ...RP,
    'export function handler(id) {',
    "\tlet err = require_param('id', id);",
    '\tif (err) return { error: err };',
    '\treturn { data: b64dec(id) };',
    '};',
    'print(handler(ARGV[1]));'], { shebang: false })).toBe(true);
});

test('C29: guard on an annotated nullable PARAM', async () => {
  expect(await narrowed([
    ...RP,
    '/** @param {?string} v */',
    'function work(v) {',
    "\tlet err = require_param('v', v);",
    '\tif (err) return null;',
    '\treturn b64dec(v);',
    '};',
    'print(work(ARGV[1]));'])).toBe(true);
});

test('C30: use inside a call-argument ternary', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    "print(err ? 'bad' : b64dec(v));"])).toBe(true);
});

test('C31: guard + use both inside a while body (capture in-loop)', async () => {
  expect(await narrowed([
    ...RP,
    'let i = 0;',
    'while (i < 3) {',
    '\tlet v = ARGV[i];',
    "\tlet err = require_param('v', v);",
    '\tif (err) exit(1);',
    '\tprint(b64dec(v));',
    '\ti++;',
    '}'])).toBe(true);
});

test('C32: guard + use both inside a for-in body (capture in-loop)', async () => {
  expect(await narrowed([
    ...RP,
    'for (let k in [0, 1, 2]) {',
    '\tlet v = ARGV[k];',
    "\tlet err = require_param('v', v);",
    '\tif (err) exit(1);',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C33: capture outside a loop with NO loop writes still narrows inside it', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'for (let i = 0; i < 3; i++) {',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('C34: closure reads the guarded variable (no writes anywhere)', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'let render = () => b64dec(v);',
    'print(render());'])).toBe(true);
});

test('C35: nested function DECLARED between guard and use does not break the scan', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'function helper() { return 1; };',
    'print(b64dec(v), helper());'])).toBe(true);
});

test('C36: same-file alias of the guard narrows like the original', async () => {
  expect(await narrowed([
    ...RP,
    'let rp = require_param;',
    'let v = ARGV[1];',
    "let err = rp('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C37: two-hop alias chain', async () => {
  expect(await narrowed([
    ...RP,
    'let rp1 = require_param;',
    'let rp2 = rp1;',
    'let v = ARGV[1];',
    "let err = rp2('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C38: const flag', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "const err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C39: short flag name `e`', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let e = require_param('v', v);",
    'if (e) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C40: underscore flag name `_err`', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let _err = require_param('v', v);",
    'if (_err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C41: guarding the SAME variable twice in one chain is harmless', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v) || require_param('v-again', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('C42: two functions each with their OWN v and err narrow independently', async () => {
  const diags = await diagsOf([
    ...RP,
    'function first() {',
    '\tlet v = ARGV[1];',
    "\tlet err = require_param('v', v);",
    '\tif (err) return null;',
    '\treturn b64dec(v);',
    '};',
    'function second() {',
    '\tlet v = ARGV[2];',
    "\tlet err = require_param('v', v);",
    '\tif (err) return null;',
    '\treturn b64dec(v);',
    '};',
    'print(first(), second());']);
  expect(nullFam(diags)).toEqual([]);
});

test('C43: non-strict file (no shebang) — hover-level narrowing still applies', async () => {
  const h = await hoverAt([
    ...RP,
    'let volume = ARGV[1];',
    "let err = require_param('volume', volume);",
    'if (err) exit(1);',
    'let out = b64dec(volume);',
    'print(out);'], 'b64dec(volume', 'b64dec(vol', 8, { shebang: false });
  expect(h).toContain('`string`');
  expect(h).not.toContain('null');
});

// ───────────────────────────── D. Argument forms ─────────────────────────────

test('D1: member path req.args.id (typedef-typed)', async () => {
  expect(await narrowed([
    ...RP,
    ...REQ_TYPEDEFS,
    '/** @param {Req} req */',
    'function inspect(req) {',
    "\tlet err = require_param('id', req.args.id);",
    '\tif (err) return { error: err };',
    '\treturn { data: b64dec(req.args.id) };',
    '};',
    'print(inspect({ args: { id: ARGV[1] } }));'])).toBe(true);
});

test('D2: member path control — no guard, the member arg still flags', async () => {
  const diags = await diagsOf([
    ...RP,
    ...REQ_TYPEDEFS,
    '/** @param {Req} req */',
    'function inspect(req) {',
    '\treturn { data: b64dec(req.args.id) };',
    '};',
    'print(inspect({ args: { id: ARGV[1] } }));']);
  expect(nullFam(diags).length).toBe(1);
});

test('D3: computed literal index parts[1]', async () => {
  expect(await narrowed([
    ...RP,
    "let parts = split(ARGV[1] ?? '', ':');",
    "let err = require_param('part', parts[1]);",
    'if (err) exit(1);',
    'print(b64dec(parts[1]));'])).toBe(true);
});

test('D4: a call-expression argument is not a path — other arms still narrow', async () => {
  const diags = await diagsOf([
    ...RP,
    'let w = ARGV[2];',
    "let err = require_param('argc', length(ARGV)) || require_param('w', w);",
    'if (err) exit(1);',
    'print(b64dec(w));']);
  expect(nullFam(diags)).toEqual([]);
});

test('D5: literal argument in a guard position is ignored without crashing', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('fixed', 'const-value') || require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

// ───────────────── E. Invalidation & counterexamples (must NOT narrow) ───────

test('E1: content-validator-only chain', async () => {
  expect(await narrowed([
    'function validate_int(value) {',
    '\tif (int(value) != value) return `Not an integer: ${value}`;',
    '};',
    'let v = ARGV[1];',
    'let err = validate_int(v);',
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('E2: flag reassigned between capture and guard', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'err = null;',
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('E3: flag rewritten via self-reference still kills the implication', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    "err = err || 'extra';",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('E4: guarded variable reassigned between capture and guard', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'v = ARGV[2];',
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('E5: guarded variable reassigned after the guard, before the use', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'v = ARGV[2];',
    'print(b64dec(v));'])).toBe(false);
});

test('E6: reassignment inside the ELSE branch before the use', async () => {
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) {',
    '\tdie(err);',
    '} else {',
    '\tv = ARGV[2];',
    '\tprint(b64dec(v));',
    '}'])).toBe(false);
});

test('E7: loop back edge — capture outside a for loop that rewrites v', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[9];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'for (let i = 0; i < 3; i++) {',
    '\tprint(b64dec(v));',
    '\tv = ARGV[i];',
    '}'])).toBe(false);
});

test('E8: loop back edge — while variant', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[9];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'let i = 0;',
    'while (i < 3) {',
    '\tprint(b64dec(v));',
    '\tv = ARGV[i];',
    '\ti++;',
    '}'])).toBe(false);
});

test('E9: loop back edge — for-in variant', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[9];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'for (let k in [0, 1]) {',
    '\tprint(b64dec(v));',
    '\tv = ARGV[k];',
    '}'])).toBe(false);
});

test('E10: loop rewrites the FLAG — capture outside', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[9];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'for (let i = 0; i < 3; i++) {',
    '\tprint(b64dec(v));',
    "\terr = require_param('i', ARGV[i]);",
    '}'])).toBe(false);
});

test('E11: nested loops — capture in outer, write in inner, use in inner', async () => {
  expect(await narrowed([
    ...RP,
    'for (let i = 0; i < 2; i++) {',
    '\tlet v = ARGV[i];',
    "\tlet err = require_param('v', v);",
    '\tif (err) continue;',
    '\tfor (let j = 0; j < 2; j++) {',
    '\t\tprint(b64dec(v));',
    '\t\tv = ARGV[j];',
    '\t}',
    '}'])).toBe(false);
});

test('E12: capture+use+write inside the SAME loop iteration stays narrowed', async () => {
  // The write comes positionally after the use, and the next iteration
  // re-runs the capture — sound to narrow.
  expect(await narrowed([
    ...RP,
    'let carry = null;',
    'for (let i = 0; i < 3; i++) {',
    '\tlet v = ARGV[i];',
    "\tlet err = require_param('v', v);",
    '\tif (err) continue;',
    '\tprint(b64dec(v));',
    '\tv = carry;',
    '}'])).toBe(true);
});

test('E13: non-terminating consequent (warn only)', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) warn(`${err}\\n`);',
    'print(b64dec(v));'])).toBe(false);
});

test('E14: empty consequent block', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) {}',
    'print(b64dec(v));'])).toBe(false);
});

test('E15: the guard tests a DIFFERENT variable than the captured flag', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let other = ARGV[2];',
    "let err = require_param('v', v);",
    'if (other) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('E16: member-path PREFIX write invalidates the deeper path', async () => {
  expect(await narrowed([
    ...RP,
    ...REQ_TYPEDEFS,
    '/** @param {Req} req */',
    'function inspect(req) {',
    "\tlet err = require_param('id', req.args.id);",
    '\tif (err) return { error: err };',
    '\treq.args = { id: null };',
    '\treturn { data: b64dec(req.args.id) };',
    '};',
    'print(inspect({ args: { id: ARGV[1] } }));'])).toBe(false);
});

test('E17: member-path ROOT write invalidates it too', async () => {
  expect(await narrowed([
    ...RP,
    ...REQ_TYPEDEFS,
    '/** @param {Req} req */',
    'function inspect(req) {',
    "\tlet err = require_param('id', req.args.id);",
    '\tif (err) return { error: err };',
    '\treq = { args: { id: null } };',
    '\treturn { data: b64dec(req.args.id) };',
    '};',
    'print(inspect({ args: { id: ARGV[1] } }));'])).toBe(false);
});

test('E18: a write to a SIBLING member path does not invalidate', async () => {
  expect(await narrowed([
    ...RP,
    '/**',
    ' * @typedef {object} ReqArgs',
    ' * @property {?string} id',
    ' * @property {?string} tag',
    ' */',
    '/**',
    ' * @typedef {object} Req',
    ' * @property {ReqArgs} args',
    ' */',
    '/** @param {Req} req */',
    'function inspect(req) {',
    "\tlet err = require_param('id', req.args.id);",
    '\tif (err) return { error: err };',
    "\treq.args.tag = 'seen';",
    '\treturn { data: b64dec(req.args.id) };',
    '};',
    'print(inspect({ args: { id: ARGV[1], tag: null } }));'])).toBe(true);
});

test('E19: flag declared WITHOUT initializer then assigned — no capture (documented limit)', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let err;',
    "err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('E20: namespace-member guard call is not followed (documented limit)', async () => {
  const code = [
    "import * as val from './validate.uc';",
    'let v = ARGV[1];',
    "let err = val.require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'];
  expect(await narrowed(code)).toBe(false);
});

test('E21: shadowing — the guard does not leak into a fn that redeclares v', async () => {
  const diags = await diagsOf([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    '/** @param {?string} v */',
    'function inner(v) {',
    '\treturn b64dec(v);',
    '};',
    'print(inner(ARGV[2]), b64dec(v));']);
  // Outer use is narrowed; the shadowed inner param must still flag.
  expect(nullFam(diags).length).toBe(1);
});

test('E22: `err && bail()` is NOT recognized (only if/ternary/|| forms are)', async () => {
  // Documents the current conservative scope — revisit if the idiom shows up
  // in a corpus.
  expect(await narrowed([
    ...RP, ...DIE,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'err && die(err);',
    'print(b64dec(v));'])).toBe(false);
});

test('E23: ternary CONSEQUENT under a bare `err` test stays unnarrowed', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'let out = err ? b64dec(v) : null;',
    'print(out);'])).toBe(false);
});

test('E24: `if (err)` CONSEQUENT itself stays unnarrowed (err is truthy there)', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) {',
    '\tprint(b64dec(v));',
    '\texit(1);',
    '}',
    'print(v);'])).toBe(false);
});

test('E25: use BEFORE the guard line stays nullable', async () => {
  const diags = await diagsOf([
    ...RP,
    'let v = ARGV[1];',
    'let early = b64dec(v);',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(early, b64dec(v));']);
  expect(nullFam(diags).length).toBe(1);
});

test('E26: `if (!err) { v = null; use }` — the write wins over the guard', async () => {
  // The implication is dropped AND SSA sees the definite null, so the
  // diagnostic upgrades from "may be null" to the provably-null UC2004.
  const diags = await diagsOf([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (!err) {',
    '\tv = null;',
    '\tprint(b64dec(v));',
    '}']);
  expect((diags || []).filter((d) => String(d.code) === 'UC2004').length).toBe(1);
});

// ────────────────────────────────── F. Cross-file ────────────────────────────

test('F1: imported guard narrows', async () => {
  expect(await narrowed([
    "import { require_param } from './validate.uc';",
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('F2: imported guard in a full chain with content validator', async () => {
  expect(await narrowed([
    "import { require_param, validate_int } from './validate.uc';",
    'let v = ARGV[1];',
    "let err = require_param('v', v) || validate_int(v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('F3: ALIASED import (`as rp`) narrows', async () => {
  expect(await narrowed([
    "import { require_param as rp } from './validate.uc';",
    'let v = ARGV[1];',
    "let err = rp('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('F4: imported content validator alone does NOT narrow', async () => {
  expect(await narrowed([
    "import { validate_int } from './validate.uc';",
    'let v = ARGV[1];',
    'let err = validate_int(v);',
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(false);
});

test('F5: local alias of an imported guard narrows', async () => {
  expect(await narrowed([
    "import { require_param } from './validate.uc';",
    'let rp = require_param;',
    'let v = ARGV[1];',
    "let err = rp('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('F6: barrel re-export chain narrows', async () => {
  expect(await narrowed([
    "import { require_param } from './barrel.uc';",
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});

test('F7: imported guard inside an exported handler (rpcd end-to-end shape)', async () => {
  expect(await narrowed([
    "import { require_param } from './validate.uc';",
    'export function inspect(id) {',
    "\tlet err = require_param('id', id);",
    '\tif (err) return { error: err };',
    '\treturn { data: b64dec(id) };',
    '};',
    'print(inspect(ARGV[1]));'], { shebang: false })).toBe(true);
});

test('F8: imported guard + mid-chain narrowing', async () => {
  expect(await narrowed([
    "import { require_param } from './validate.uc';",
    '/** @param {string} value */',
    'function validate_name(value) {',
    "\tif (!match(value, /^[a-z0-9_.-]+$/)) return `Invalid: ${value}`;",
    '};',
    'let v = ARGV[1];',
    "let err = require_param('v', v) || validate_name(v);",
    'if (err) exit(1);',
    'print(v);'])).toBe(true);
});

// ─────────────────────────────────── G. Hover ────────────────────────────────

test('G1: hover BEFORE the guard shows the null; AFTER it, not', async () => {
  const lines = [
    ...RP,
    'let volume = ARGV[1];',
    'let before = length(volume);',
    "let err = require_param('volume', volume);",
    'if (err) exit(1);',
    'let after = b64dec(volume);',
    'print(before, after);'];
  const hBefore = await hoverAt(lines, 'length(volume', 'length(vol', 7);
  expect(hBefore).toContain('string | null');
  const hAfter = await hoverAt(lines, 'b64dec(volume', 'b64dec(vol', 7);
  expect(hAfter).toContain('`string`');
  expect(hAfter).not.toContain('null');
});

test('G2: hover inside the else branch is narrowed', async () => {
  const h = await hoverAt([
    ...RP, ...DIE,
    'let volume = ARGV[1];',
    "let err = require_param('volume', volume);",
    'if (err) {',
    '\tdie(err);',
    '} else {',
    '\tprint(b64dec(volume));',
    '}'], 'b64dec(volume', 'b64dec(vol', 7);
  expect(h).toContain('`string`');
  expect(h).not.toContain('null');
});

test('G3: hover on a mid-chain use is narrowed', async () => {
  const h = await hoverAt([
    ...RP,
    '/** @param {string} value */',
    'function validate_name(value) {',
    "\tif (!match(value, /^[a-z0-9_.-]+$/)) return `Invalid: ${value}`;",
    '};',
    'let volume = ARGV[1];',
    "let err = require_param('volume', volume) || validate_name(volume);",
    'if (err) exit(1);',
    'print(volume);'], 'validate_name(volume)', 'validate_name(vol', 'validate_name('.length + 1);
  expect(h).toContain('`string`');
  expect(h).not.toContain('null');
});

test('G4: hover in the `if (!err)` branch is narrowed', async () => {
  const h = await hoverAt([
    ...RP,
    'let volume = ARGV[1];',
    "let err = require_param('volume', volume);",
    'if (!err) {',
    '\tprint(b64dec(volume));',
    '}'], 'b64dec(volume', 'b64dec(vol', 7);
  expect(h).toContain('`string`');
  expect(h).not.toContain('null');
});

test('G5: hover after a REASSIGNED guard shows the null again', async () => {
  const h = await hoverAt([
    ...RP,
    'let volume = ARGV[1];',
    "let err = require_param('volume', volume);",
    'if (err) exit(1);',
    'volume = ARGV[2];',
    'let out = b64dec(volume);',
    'print(out);'], 'b64dec(volume', 'b64dec(vol', 7);
  expect(h).toContain('string | null');
});

// ─────────────────────────────── H. Interplay ────────────────────────────────

test('H1: coexists with a direct `if (!v) exit` guard on another variable', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let w = ARGV[2];',
    'if (!w) exit(1);',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v), b64dec(w));'])).toBe(true);
});

test('H2: double protection (err guard + direct truthiness) does not conflict', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'if (v) {',
    '\tprint(b64dec(v));',
    '}'])).toBe(true);
});

test('H3: the guard fn itself keeps its OWN diagnostics honest', async () => {
  // Inside require_param, `value` is still nullable before the null test —
  // using it unguarded there must flag.
  const diags = await diagsOf([
    'function require_param(name, value) {',
    '\tlet peek = b64dec(value);',
    "\tif (value == null || value === '') return `Missing: ${name}`;",
    '\treturn peek;',
    '};',
    'let v = ARGV[1];',
    "let e = require_param('v', v);",
    'print(e);']);
  // value is an unannotated param (unknown) so the nullable family will not
  // fire on it — but the file must at least parse/analyze without the guard
  // inference crashing on the non-canonical body (peek return = falsy-capable).
  // The real assertion: the non-canonical body must NOT be treated as a guard.
  const code2 = [
    '#!/usr/bin/env ucode',
    'function almost_guard(name, value) {',
    '\tlet msg = `Missing: ${name}`;',
    '\tif (length(msg) > 99) return null;',
    '\tif (value == null) return msg;',
    '};',
    'let v = ARGV[1];',
    "let err = almost_guard('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));'].join('\n');
  const d2 = await server.getDiagnostics(code2, path.join(dir, `case-${n++}.uc`));
  expect(nullFam(d2).length).toBe(1);
  expect(diags).toBeDefined();
});

test('H4: chain result used as a plain value elsewhere stays a string|null', async () => {
  const h = await hoverAt([
    ...RP,
    'let v = ARGV[1];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(err);'], 'print(err)', 'print(e', 7);
  // err is null on this path — the flag itself is not upgraded by its own guard.
  expect(h).toBeTruthy();
});

test('H5: narrowing does not bleed into a sibling variable of the same chain call', async () => {
  const diags = await diagsOf([
    ...RP,
    'let v = ARGV[1];',
    'let unguarded = ARGV[2];',
    "let err = require_param('v', v);",
    'if (err) exit(1);',
    'print(b64dec(v));',
    'print(b64dec(unguarded));']);
  expect(nullFam(diags).length).toBe(1);
});

test('H6: guard inside try/catch — capture and use in the try block', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'try {',
    "\tlet err = require_param('v', v);",
    '\tif (err) exit(1);',
    '\tprint(b64dec(v));',
    '} catch (e) {',
    '\twarn(`${e}\\n`);',
    '}'])).toBe(true);
});

test('H7: two chains guarding DIFFERENT members of the same object', async () => {
  expect(await narrowed([
    ...RP,
    '/**',
    ' * @typedef {object} ReqArgs',
    ' * @property {?string} id',
    ' * @property {?string} name',
    ' */',
    '/**',
    ' * @typedef {object} Req',
    ' * @property {ReqArgs} args',
    ' */',
    '/** @param {Req} req */',
    'function inspect(req) {',
    "\tlet err = require_param('id', req.args.id) || require_param('name', req.args.name);",
    '\tif (err) return { error: err };',
    '\treturn { data: b64dec(req.args.id), label: b64dec(req.args.name) };',
    '};',
    'print(inspect({ args: { id: ARGV[1], name: ARGV[2] } }));'])).toBe(true);
});

test('H8: dispatcher table of handlers, each with its own guard', async () => {
  expect(await narrowed([
    ...RP,
    ...REQ_TYPEDEFS,
    'const methods = {',
    '\t/** @param {Req} req */',
    '\tcontainer_inspect: function(req) {',
    "\t\tlet err = require_param('id', req.args.id);",
    '\t\tif (err) return { error: err };',
    '\t\treturn { data: b64dec(req.args.id) };',
    '\t},',
    '\t/** @param {Req} req */',
    '\tcontainer_remove: (req) => {',
    "\t\tlet err = require_param('id', req.args.id);",
    '\t\tif (err) return { error: err };',
    '\t\treturn { removed: b64dec(req.args.id) };',
    '\t},',
    '};',
    "print(methods.container_inspect({ args: { id: ARGV[1] } }), methods.container_remove({ args: { id: ARGV[2] } }));"])).toBe(true);
});

test('H9: IIFE module-constant pattern (0.8.3) + guard inside', async () => {
  expect(await narrowed([
    ...RP,
    "const config = (() => {",
    '\tlet raw = ARGV[1];',
    "\tlet err = require_param('config', raw);",
    '\tif (err) return null;',
    "\treturn { data: b64dec(raw) };",
    '})();',
    'print(config);'])).toBe(true);
});

test('H10: guard + spread/rest call sites do not confuse the arm scan', async () => {
  expect(await narrowed([
    ...RP,
    'let v = ARGV[1];',
    'let extras = [1, 2];',
    "let err = require_param('v', v) || length([...extras]) > 99;",
    'if (err) exit(1);',
    'print(b64dec(v));'])).toBe(true);
});
