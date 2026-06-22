// auto-docs/10: render() is two-faced, decided by the first argument's type (verified vs
// /usr/local/bin/ucode + ucode/lib.c uc_render):
//   render(path: string, scope?: object)  — include-like; max 2 args; returns string|null.
//   render(fn: function, ...args)          — calls fn, forwards ALL trailing args; returns the
//                                            captured output string|null (NOT fn's value).
// It was modeled as a fixed render(string, scope?) (maxParams 2), so render(fn, a, b, c)
// false-errored "expects at most 2 arguments" + "possibly function, expected string".
// Fix: validateRenderFunction branches on arg0's type. A provably non-string/non-function
// first arg (render(5)) is a runtime error; an unknown first arg is flagged (narrow it).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/render-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri()) || []);
const errs = async (code) => (await diags(code)).filter((x) => x.severity === 1).map((x) => x.message);
const all = async (code) => (await diags(code)).map((x) => x.message);

// ── Function form: variadic, any arity, any trailing-arg types ───────────────
test('render(fn, 1, 2, 3) is clean (variadic function form)', async () => {
  expect(await errs('function g(a, b, c) {}\nrender(g, 1, 2, 3);\n')).toEqual([]);
});
test('render(fn, x) is clean', async () => {
  expect(await errs('function g(a) {}\nrender(g, 5);\n')).toEqual([]);
});
test('render(arrow, ...) is clean', async () => {
  expect(await errs('render(() => {}, 1, 2, 3, 4);\n')).toEqual([]);
});
test('render no longer emits "at most 2 arguments" for the function form (regression)', async () => {
  expect((await all('function g(a,b,c){}\nrender(g, 1, 2, 3);\n')).some((m) => /at most 2 arguments/.test(m))).toBe(false);
});
test('render(fn, ...) does not flag "possibly function, expected string" (regression)', async () => {
  expect((await all('function g(){}\nrender(g, 1);\n')).some((m) => /expected string/.test(m))).toBe(false);
});

// ── String/template form: render(path, scope?) ───────────────────────────────
test('render("path", {scope}) is clean', async () => {
  expect(await errs('render("/tmp/t.uc", { x: 1 });\n')).toEqual([]);
});
test('render("path", null) is clean (null scope)', async () => {
  expect(await errs('render("/tmp/t.uc", null);\n')).toEqual([]);
});
test('render("path") (one arg) is clean', async () => {
  expect(await errs('render("/tmp/t.uc");\n')).toEqual([]);
});
test('render("path", {}, extra) is flagged (template form max 2)', async () => {
  expect((await errs('render("/tmp/t.uc", {}, 99);\n')).some((m) => /template form.*at most 2/.test(m))).toBe(true);
});
test('render("path", 5) flags a non-object/null scope', async () => {
  expect((await errs('render("/tmp/t.uc", 5);\n')).some((m) => /object or null/.test(m))).toBe(true);
});

// ── First arg must be string or function ─────────────────────────────────────
test('render(5) is flagged (first arg must be string or function)', async () => {
  expect((await errs('render(5);\n')).some((m) => /string or function/.test(m))).toBe(true);
});
test('render({}) is flagged', async () => {
  expect((await errs('render({a:1});\n')).some((m) => /string or function/.test(m))).toBe(true);
});
test('render(null) is flagged', async () => {
  expect((await errs('render(null);\n')).some((m) => /string or function/.test(m))).toBe(true);
});
test('render(unknownParam) is flagged (narrow to string or function)', async () => {
  // warning non-strict; the message names string|function
  expect((await all('function f(x) { render(x); }\n')).some((m) => /unknown.*string \| function|string \| function/.test(m))).toBe(true);
});
test('render() with no args is flagged (needs at least 1)', async () => {
  expect((await errs('render();\n')).some((m) => /at least 1/.test(m))).toBe(true);
});

// ── Return type is string|null for BOTH forms ────────────────────────────────
async function hoverType(code, marker, id) {
  const i = code.lastIndexOf(marker) + marker.indexOf(id);
  const pre = code.slice(0, i);
  const line = (pre.match(/\n/g) || []).length;
  const col = i - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, uri(), line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}
test('string form returns string | null', async () => {
  expect(await hoverType('let r = render("/tmp/t.uc", {});\n', 'let r', 'r')).toMatch(/string \| null/);
});
test('function form returns string | null', async () => {
  expect(await hoverType('function g(){}\nlet r = render(g, 1);\n', 'let r', 'r')).toMatch(/string \| null/);
});

// ── Signature help shows BOTH overloads (autocomplete) ───────────────────────
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer.ts');
const { provideSignatureHelp } = require('../../src/signatureHelp.ts');
const { allBuiltinFunctions } = require('../../src/builtins.ts');
function sigHelp(codeWithCursor) {
  const off = codeWithCursor.indexOf('|');
  const code = codeWithCursor.replace('|', '');
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = { getText: () => code, positionAt: () => ({ line: 0, character: 0 }), offsetAt: () => 0, uri: 'file:///t.uc' };
  const r = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
  return provideSignatureHelp(ast, r.symbolTable, allBuiltinFunctions, off);
}

test('render() signature help offers BOTH overloads', () => {
  const sh = sigHelp('render(|);');
  expect(sh.signatures.length).toBe(2);
  const labels = sh.signatures.map((s) => s.label);
  expect(labels.some((l) => /\.\.\.args/.test(l))).toBe(true);   // function form
  expect(labels.some((l) => /scope/.test(l))).toBe(true);        // template form
});
test('render(arrow, …) makes the function form active', () => {
  const sh = sigHelp('render(() => {}, |);');
  expect(/\.\.\.args/.test(sh.signatures[sh.activeSignature].label)).toBe(true);
});
test('render("str", …) makes the template form active', () => {
  const sh = sigHelp('render("tmpl", |);');
  expect(/scope/.test(sh.signatures[sh.activeSignature].label)).toBe(true);
});
test('a single-block builtin (keys) still has exactly one signature', () => {
  const sh = sigHelp('keys(|);');
  expect(sh.signatures.length).toBe(1);
});
