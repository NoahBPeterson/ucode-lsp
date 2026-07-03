// delete-non-member-uc6012 + no-op-delete-uc8008: the parser accepted any unary
// operand after `delete`, but ucode's uc_compiler_compile_delete requires the operand
// to compile to a property access ("expecting a property access expression") —
// unconditionally, strict AND non-strict, since the operator form landed (the
// strict-only lore came from the legacy delete(obj, key) CALL form, removed 2022-01;
// every supported target post-dates it). So `delete object;` is always a compile
// error → UC6012. Separately, `delete obj.b` where b is provably never assigned on a
// fully-visible literal is a runtime no-op returning false → UC8008 warning (rides
// the UC8007 taint machinery, so escapes/computed writes silence it).
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/delete-nonmember-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const byCode = async (code, c) => (await diags(code)).filter((d) => d.code === c);

// ── UC6012: must flag (ucode: "expecting a property access expression") ───────
test('delete on a bare identifier is an error', async () => {
  const ds = await byCode("let object = {'a': 1};\ndelete object;\n", 'UC6012');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('property access expression');
});
test('delete on a call result is an error', async () => {
  expect((await byCode('function foo() { return {}; }\ndelete foo();\n', 'UC6012')).length).toBe(1);
});
test('delete on a literal is an error', async () => {
  expect((await byCode('delete 42;\n', 'UC6012')).length).toBe(1);
});
test('diagnostic anchors on the operand', async () => {
  const ds = await byCode("let object = {'a': 1};\ndelete object;\n", 'UC6012');
  expect(ds[0].range.start.line).toBe(1);
  expect(ds[0].range.start.character).toBe(7);
  expect(ds[0].range.end.character).toBe(13);
});

// ── UC6012: must stay clean (valid ucode) ─────────────────────────────────────
test('delete obj.key stays clean', async () => {
  expect((await byCode("let object = {'a': 1};\ndelete object.a;\n", 'UC6012')).length).toBe(0);
});
test('delete obj[key] (computed) stays clean', async () => {
  expect((await byCode("let object = {'a': 1};\nlet k = 'a';\ndelete object[k];\n", 'UC6012')).length).toBe(0);
});
test('parenthesized member delete (obj.a) stays clean', async () => {
  expect((await byCode("let object = {'a': 1};\ndelete (object.a);\n", 'UC6012')).length).toBe(0);
});
test('nested member delete obj.a.b stays clean', async () => {
  expect((await byCode("let object = {'a': {'b': 1}};\ndelete object.a.b;\n", 'UC6012')).length).toBe(0);
});

// ── UC8008: no-op delete on a provably-missing property ──────────────────────
test("delete object.b on a closed shape without 'b' warns (the m00qek repro)", async () => {
  const ds = await byCode("let object = {'a': [1,2,3,4,5]};\ndelete object.b;\n", 'UC8008');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(2); // warning — it runs fine, it just does nothing
  expect(ds[0].message).toContain('no effect');
});
test('delete of a literal-defined property does NOT warn', async () => {
  expect((await byCode("let object = {'a': 1};\ndelete object.a;\n", 'UC8008')).length).toBe(0);
});
test('delete of a property assigned later (incl. closures) does NOT warn', async () => {
  const code = "let object = {'a': 1};\nfunction warm() { object.b = 2; }\nwarm();\ndelete object.b;\n";
  expect((await byCode(code, 'UC8008')).length).toBe(0);
});
test('escaped object (passed as a value) is silenced — no UC8008', async () => {
  const code = "let object = {'a': 1};\nfunction touch(o) { o.b = 1; }\ntouch(object);\ndelete object.b;\n";
  expect((await byCode(code, 'UC8008')).length).toBe(0);
});
test('computed write taints the shape — no UC8008', async () => {
  const code = "let object = {'a': 1};\nlet k = 'b';\nobject[k] = 1;\ndelete object.b;\n";
  expect((await byCode(code, 'UC8008')).length).toBe(0);
});
test('non-static literal (spread) is never a candidate — no UC8008', async () => {
  const code = "let base = {'b': 1};\nlet object = {'a': 1, ...base};\ndelete object.b;\n";
  expect((await byCode(code, 'UC8008')).length).toBe(0);
});
