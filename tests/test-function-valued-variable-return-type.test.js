// A function value bound to a variable — `let f = () => {…}` or `let f = function(){…}`
// — now infers its return type, so `f(...)` at a call site resolves like a named
// function. Previously only top-level named declarations did; arrow/anon-expression
// results were `unknown`, spuriously flagging downstream member/arg checks.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/fvr-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}
const errs = async (code) => (await server.getDiagnostics(code, `/tmp/fvr-${n++}.uc`) || []).filter((x) => x.severity === 1).map((x) => x.message);

// ── Arrow, block body ────────────────────────────────────────────────────────
test('01 arrow with a single string return → call result is string', async () => {
  expect(await typeOf('let f = (p) => { return "x"; };\nlet r = f(1);\nlet z = r;\n', 'z = r')).toContain('string');
});
test('02 arrow with string-or-null returns → call result is string | null', async () => {
  expect(await typeOf('let f = (p) => { if (p) return "x"; return null; };\nlet r = f(1);\nlet z = r;\n', 'z = r')).toContain('string | null');
});

// ── Anonymous function expression ────────────────────────────────────────────
test('03 anonymous function-expression value infers its return type', async () => {
  expect(await typeOf('let g = function(p) { return 42; };\nlet r = g(1);\nlet z = r;\n', 'z = r')).toContain('integer');
});
test('04 const-bound function value works too', async () => {
  expect(await typeOf('const g = function() { return true; };\nlet r = g();\nlet z = r;\n', 'z = r')).toContain('boolean');
});

// ── Expression-body arrows ───────────────────────────────────────────────────
test('05 expression-body arrow returning a string literal', async () => {
  expect(await typeOf('let h = (x) => "result";\nlet r = h(1);\nlet z = r;\n', 'z = r')).toContain('string');
});
test('06 expression-body arrow returning a number literal', async () => {
  expect(await typeOf('let h = (x) => 42;\nlet r = h(1);\nlet z = r;\n', 'z = r')).toContain('integer');
});

// ── The original mocklib use-case ────────────────────────────────────────────
test('07 read_data_file()-style arrow → json(data) type-checks after a null guard', async () => {
  const code = 'import * as fs from "fs";\n'
    + 'let read_data = (p) => { let fd = fs.open(p, "r"); if (fd) { let d = fd.read("all"); return d; } return null; };\n'
    + 'let data = read_data("x");\n'
    + 'let out = data != null ? json(data) : null;\n';
  expect((await errs(code)).some((m) => /json/.test(m) && /unknown|string or object/i.test(m))).toBe(false);
});
test('08 the function value result hovers as string | null (not unknown)', async () => {
  const code = 'import * as fs from "fs";\n'
    + 'let read_data = (p) => { let fd = fs.open(p, "r"); if (fd) { return fd.read("all"); } return null; };\n'
    + 'let data = read_data("x");\nlet z = data;\n';
  const t = await typeOf(code, 'z = data');
  expect(t).toContain('string');
  expect(t).not.toMatch(/^\(variable\) \*\*z\*\*: `unknown`/);
});

// ── Regression / robustness ──────────────────────────────────────────────────
test('09 a top-level named function still infers its return type', async () => {
  expect(await typeOf('function k(p) { return "s"; }\nlet r = k(1);\nlet z = r;\n', 'z = r')).toContain('string');
});
test('10 an untyped-param expression (x => x + 1) stays unknown (no over-claim)', async () => {
  expect(await typeOf('let h = (x) => x + 1;\nlet r = h(2);\nlet z = r;\n', 'z = r')).toContain('unknown');
});
test('11 nested arrows do not crash and the outer return type is inferred', async () => {
  const code = 'let outer = () => { let inner = (y) => y; return "ok"; };\nlet r = outer();\nlet z = r;\n';
  expect(await typeOf(code, 'z = r')).toContain('string');
});
test('12 a bare callback arrow (map) is unaffected — no false diagnostics', async () => {
  const code = 'let xs = map([1,2,3], (n) => n * 2);\n';
  expect((await errs(code)).length).toBe(0);
});
