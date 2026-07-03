// param-after-rest-uc6011: `function f(a, b, ...rest, x) {}` used to derail the
// parser into a diagnostic cascade (the stray `,x` broke the `)` consume and
// everything after). ucode leaves the param loop after a rest param and expects
// `)` — one "Expecting ')'" compile error. Now every function form (declaration,
// function expression, arrow) emits exactly ONE UC6011 anchored on the comma after
// the rest param, and keeps parsing the trailing params so they stay declared and
// the body still analyzes.
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/param-after-rest-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const afterRest = async (code) => (await diags(code)).filter((d) => d.code === 'UC6011');
const errors = async (code) => (await diags(code)).filter((d) => d.severity === 1);

// ── must flag, exactly once (ucode: "Expecting ')'") ─────────────────────────
test('function declaration: params after ...rest → one UC6011, no cascade', async () => {
  const code = 'function test(a, b, c, ...rest, f) {\n    print(a, b, c, rest, f);\n}\ntest(1, 2, 3, 4, 5);\n';
  const ds = await afterRest(code);
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('final parameter');
  // the single UC6011 is the ONLY error — the old cascade is gone
  expect((await errors(code)).length).toBe(1);
});
test('diagnostic anchors on the comma after the rest param', async () => {
  const ds = await afterRest('function test(a, ...rest, f) {\n    print(a, rest, f);\n}\n');
  expect(ds[0].range.start.line).toBe(0);
  expect(ds[0].range.start.character).toBe(24); // `function test(a, ...rest` → the `,` after rest
});
test('function expression: params after ...rest → one UC6011', async () => {
  const code = 'let fn = function(a, ...rest, f) {\n    print(a, rest, f);\n};\nfn(1, 2, 3);\n';
  expect((await afterRest(code)).length).toBe(1);
});
test('arrow function: params after ...rest → one UC6011 (not an expression derail)', async () => {
  const code = 'let fn = (a, ...rest, f) => {\n    print(a, rest, f);\n};\nfn(1, 2, 3);\n';
  const ds = await afterRest(code);
  expect(ds.length).toBe(1);
  expect((await errors(code)).length).toBe(1);
});
test('several params after rest still yield ONE diagnostic', async () => {
  expect((await afterRest('function t(...rest, x, y, z) {\n    print(rest, x, y, z);\n}\n')).length).toBe(1);
});

// ── must stay clean (valid ucode) ────────────────────────────────────────────
test('rest param in final position stays clean', async () => {
  expect((await errors('function t(a, b, ...rest) {\n    print(a, b, rest);\n}\nt(1, 2, 3, 4);\n')).length).toBe(0);
});
test('rest-only signature stays clean', async () => {
  expect((await errors('function t(...rest) {\n    print(rest);\n}\nt(1);\n')).length).toBe(0);
});
test('arrow with final rest param stays clean', async () => {
  expect((await errors('let fn = (a, ...rest) => print(a, rest);\nfn(1, 2);\n')).length).toBe(0);
});
test('spread at a CALL site is unaffected', async () => {
  expect((await errors('function t(a, b, c) {\n    print(a, b, c);\n}\nlet xs = [1, 2];\nt(...xs, 3);\n')).length).toBe(0);
});

// ── recovery ─────────────────────────────────────────────────────────────────
test('trailing params stay declared — body use produces no UC1001', async () => {
  const ds = await diags('function test(a, ...rest, f) {\n    print(a, rest, f);\n}\ntest(1, 2, 3);\n');
  expect(ds.some((d) => d.code === 'UC1001')).toBe(false);
});
test('analysis continues after the broken signature', async () => {
  const ds = await diags('function t(...rest, x) {\n    print(rest, x);\n}\nlet z = undefined_thing;\n');
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
});
