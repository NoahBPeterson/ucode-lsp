// m00qek-fidelity-round2: parse-time divergences from real ucode, found by diffing
// tree-sitter-ucode v0.7.0..v0.8.0 against our lexer and parser. Every case here was
// verified against a build of the vendored ucode tree (3ec4e5c), not just read off the
// C source. See docs/done/m00qek-parser-fidelity-2.md.
//
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/m00qek-r2-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const byCode = async (code, c) => (await diags(code)).filter((d) => d.code === c);

// ── UC6018: numeric object keys ──────────────────────────────────────────────
// ucode's object parser matches only a label or a string at the key position
// (compiler.c:2246-2250, "Expecting label"); computed `[1]:` is the escape hatch.
test('bare numeric key {1: 2} is an error', async () => {
  const ds = await byCode('let o = {1: 2};\nprint(o);\n', 'UC6018');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('Numeric object key');
});
test('numeric key diagnostic anchors on the key token', async () => {
  const ds = await byCode('let o = {1: 2};\n', 'UC6018');
  // `let o = {1: 2};` — the key is at character 9
  expect(ds[0].range.start.line).toBe(0);
  expect(ds[0].range.start.character).toBe(9);
  expect(ds[0].range.end.character).toBe(10);
});
test('a double key {1.5: 2} is flagged too', async () => {
  expect((await byCode('let o = {1.5: 2};\nprint(o);\n', 'UC6018')).length).toBe(1);
});
test('each numeric key gets its own diagnostic', async () => {
  expect((await byCode('let o = {1: "a", 2: "b"};\nprint(o);\n', 'UC6018')).length).toBe(2);
});
test('a numeric key does not swallow later diagnostics', async () => {
  const ds = await diags('let o = {1: "a"};\nprint(nope);\n');
  expect(ds.some((d) => /Undefined variable: nope/.test(d.message))).toBe(true);
});
test('quoted key {"1": 2} is clean', async () => {
  expect((await byCode('let o = {"1": 2};\nprint(o);\n', 'UC6018')).length).toBe(0);
});
test('computed key {[1]: 2} is clean', async () => {
  expect((await byCode('let o = {[1]: 2};\nprint(o);\n', 'UC6018')).length).toBe(0);
});
test('label key {a: 1} is clean', async () => {
  expect((await byCode('let o = {a: 1};\nprint(o);\n', 'UC6018')).length).toBe(0);
});
