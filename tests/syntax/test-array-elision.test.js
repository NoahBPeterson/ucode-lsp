// array-elision-uc6008: the parser deliberately supported JS array holes
// (`[1,,2]` → elements [1, null, 2]) and stayed silent, but ucode has no elision —
// uc_compiler_compile_array demands an expression after every comma ("Expecting
// expression"), so such code cannot even compile. Trailing commas ARE valid ucode
// (`[1,2,]` — the comma-then-] path breaks out) and must stay clean. The null
// element is still pushed for recovery so later indices keep their positions.
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/array-elision-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const holes = async (code) => (await diags(code)).filter((d) => d.code === 'UC6008');

// ── must flag (ucode: "Expecting expression") ────────────────────────────────
test('interior hole [1,,2] is an error', async () => {
  const hs = await holes('let a = [1,,2];\nprint(a);\n');
  expect(hs.length).toBe(1);
  expect(hs[0].severity).toBe(1);
  expect(hs[0].message).toContain('array holes');
});
test('leading hole [,1] is an error', async () => {
  expect((await holes('let a = [,1];\nprint(a);\n')).length).toBe(1);
});
test('hole-only [,] is an error', async () => {
  expect((await holes('let a = [,];\nprint(a);\n')).length).toBe(1);
});
test('multiple holes each get their own diagnostic', async () => {
  expect((await holes('let a = [1,,2,,3];\nprint(a);\n')).length).toBe(2);
});
test('diagnostic anchors on the offending comma', async () => {
  const hs = await holes('let a = [1,,2];\n');
  // `let a = [1,,2];` — the hole comma is at character 11
  expect(hs[0].range.start.line).toBe(0);
  expect(hs[0].range.start.character).toBe(11);
  expect(hs[0].range.end.character).toBe(12);
});

// ── must stay clean (valid ucode) ────────────────────────────────────────────
test('plain array [1,2] has no hole diagnostic', async () => {
  expect((await holes('let a = [1,2];\nprint(a);\n')).length).toBe(0);
});
test('trailing comma [1,2,] is valid ucode — no diagnostic', async () => {
  expect((await holes('let a = [1,2,];\nprint(a);\n')).length).toBe(0);
});
test('empty array [] has no hole diagnostic', async () => {
  expect((await holes('let a = [];\nprint(a);\n')).length).toBe(0);
});
test('spread with trailing comma [...b, 1] stays clean', async () => {
  expect((await holes('let b = [1];\nlet a = [...b, 1];\nprint(a);\n')).length).toBe(0);
});

// ── recovery ─────────────────────────────────────────────────────────────────
test('parsing recovers: elements after the hole keep their indices and later code is analyzed', async () => {
  const ds = await diags('let a = [1,,2];\nlet z = undefined_thing;\n');
  expect(ds.some((d) => d.code === 'UC6008')).toBe(true);
  // the undefined-variable check downstream still runs (no cascade/panic swallow)
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
});
test('no cascade: [1,,2] produces exactly one error total', async () => {
  const ds = (await diags('let a = [1,,2];\nprint(a);\n')).filter((d) => d.severity === 1);
  expect(ds.length).toBe(1);
});
