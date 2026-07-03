// for-const-uc6009: the parser explicitly accepted `const` in both for forms, but
// ucode's for grammar only matches TK_LOCAL (`let`) — uc_compiler_compile_for lets
// `const` fall through to the expression path → "Expecting expression", a compile
// error in both strict and non-strict modes. Applies to `for (const a in x)` AND
// C-style `for (const i = 0; …)`. We keep parsing the declaration (scope/type
// recovery: the loop variable stays declared and typed) but surface UC6009 anchored
// on the `const` keyword.
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/for-const-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const forConst = async (code) => (await diags(code)).filter((d) => d.code === 'UC6009');

// ── must flag (ucode: "Expecting expression") ────────────────────────────────
test('for (const a in obj) is an error', async () => {
  const ds = await forConst("let obj = { a: [1, 2] };\nfor (const a in obj['a']) { print(a); }\n");
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain("'const' in a for loop");
});
test("C-style for (const i = 0; …) is an error", async () => {
  expect((await forConst('for (const i = 0; i < 3; i = i) { print(i); }\n')).length).toBe(1);
});
test('diagnostic anchors on the const keyword', async () => {
  const ds = await forConst('let obj = { a: 1 };\nfor (const k in obj) { print(k); }\n');
  expect(ds[0].range.start.line).toBe(1);
  expect(ds[0].range.start.character).toBe(5);
  expect(ds[0].range.end.character).toBe(10);
});
test('two-variable form for (const k, v in obj) is an error', async () => {
  expect((await forConst('let obj = { a: 1 };\nfor (const k, v in obj) { print(k, v); }\n')).length).toBe(1);
});

// ── must stay clean (valid ucode) ────────────────────────────────────────────
test('for (let a in obj) stays clean', async () => {
  expect((await forConst("let obj = { a: 1 };\nfor (let a in obj) { print(a); }\n")).length).toBe(0);
});
test('C-style for (let i = 0; …) stays clean', async () => {
  expect((await forConst('for (let i = 0; i < 3; i++) { print(i); }\n')).length).toBe(0);
});
test('bare for (x in obj) with predeclared x stays clean', async () => {
  expect((await forConst('let obj = { a: 1 };\nlet x;\nfor (x in obj) { print(x); }\n')).length).toBe(0);
});
test('const OUTSIDE a for loop stays clean', async () => {
  expect((await forConst('const limit = 5;\nfor (let i = 0; i < limit; i++) { print(i); }\n')).length).toBe(0);
});

// ── recovery ─────────────────────────────────────────────────────────────────
test('loop variable stays declared and typed after the error (no UC1001 cascade)', async () => {
  const ds = await diags("let obj = { a: [1, 2] };\nfor (const a in obj['a']) { print(a); }\n");
  expect(ds.some((d) => d.code === 'UC6009')).toBe(true);
  expect(ds.some((d) => d.code === 'UC1001')).toBe(false);
});
test('analysis continues after the flagged loop', async () => {
  const ds = await diags('let obj = { a: 1 };\nfor (const k in obj) { print(k); }\nlet z = undefined_thing;\n');
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
});
