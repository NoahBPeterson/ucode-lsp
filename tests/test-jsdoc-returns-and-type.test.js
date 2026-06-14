// #61 @returns — apply the annotation to the function's return type, reconciled SOUNDLY
// against inference. A JSDoc type isn't runtime-checked, so it may only FILL an `unknown`
// body or restate/widen — it may NOT be narrower than what the code provably produces
// (no silent `string|null` -> `string`). Anything narrower/disjoint is flagged UC7005 and
// the inferred type wins.
//
// (#62 @type on variables was deliberately NOT implemented — an unverified assertion with no
//  safety floor; see docs/auto-docs/62-jsdoc-type-tag-unsupported.md.)
//
// Placement (per-return precision):
//   • a `return` the annotation doesn't cover -> on THAT return statement
//   • @returns on a function with NO return    -> on the @returns tag (returns null)
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const diags = async (code) => (await s.getDiagnostics(code, `/tmp/jdt-${n++}.uc`)) || [];
const codes = (ds) => ds.map((d) => d.code || '(none)');

// ── @returns FILLS an opaque body (adds info where there was none) ──
test('@returns fills an unknown body (call result becomes the declared type)', async () => {
  const m = (await diags('/** @returns {string} */\nfunction f(p) { return p; }\nlet r = f(1); r.foo();\n')).map((d) => d.message);
  expect(m.some((x) => /does not exist on string/.test(x))).toBe(true);
});
test('@returns matching the body is clean', async () => {
  expect(codes(await diags('/** @returns {string} */\nfunction f() { return "a"; }\n'))).not.toContain('UC7005');
});
test('@returns {double} on `return 5` is lenient (int/double unified)', async () => {
  expect(codes(await diags('/** @returns {double} */\nfunction f() { return 5; }\n'))).not.toContain('UC7005');
});
test('@returns {string|null} covering a string|null body is honoured (clean)', async () => {
  expect(codes(await diags('/** @returns {string|null} */\nfunction f() { return getenv("X"); }\n'))).not.toContain('UC7005');
});

// ── SOUNDNESS: the annotation may not be narrower than the body ──
test('@returns {string} over a string|null body is flagged (no silent narrowing)', async () => {
  const ds = await diags('/** @returns {string} */\nfunction f() { return getenv("X"); }\n');
  const u = ds.find((d) => d.code === 'UC7005');
  expect(u).toBeTruthy();
  expect(u.range.start.line).toBe(1);
  expect(u.message).toMatch(/string\|null.*does not cover/);
});
test('a contradicting return is flagged ON the return statement', async () => {
  const ds = await diags('/** @returns {string} */\nfunction f() { return 5; }\n');
  const u = ds.find((d) => d.code === 'UC7005');
  expect(u.range.start.line).toBe(1);
  expect(u.message).toMatch(/integer.*does not cover/);
});
test('per-return: only the uncovered return is flagged, not the matching one', async () => {
  const ds = await diags('/** @returns {string} */\nfunction f(x) { if (x) return "a"; return 5; }\n');
  const u = ds.filter((d) => d.code === 'UC7005');
  expect(u.length).toBe(1);
  expect(u[0].range.start.character).toBeGreaterThan(20);
});
test('@returns with NO return statement is flagged ON the @returns tag', async () => {
  const ds = await diags('/** @returns {string} */\nfunction f() { let y = 1; }\n');
  const u = ds.find((d) => d.code === 'UC7005');
  expect(u.range.start.line).toBe(0);
  expect(u.message).toMatch(/no return statement/);
});

// ── unknown type name, and the trailing-comment adjacency fix ──
test('an unknown @returns type name reports UC7001', async () => {
  expect(codes(await diags('/** @returns {Frobnicate} */\nfunction f(){ return 1; }\n'))).toContain('UC7001');
});
test('a trailing // comment on the JSDoc line does not sever attachment', async () => {
  expect(codes(await diags('/** @returns {string} */ // note\nfunction f(){ return 5; }\n'))).toContain('UC7005');
});

// ── @type is intentionally a no-op on variables (not implemented) ──
test('@type {T} on a variable does nothing (no UC7005, no application)', async () => {
  expect(codes(await diags('/** @type {string} */\nlet x = 5;\n'))).not.toContain('UC7005');
  expect(codes(await diags('/** @type {string} */\nlet label;\n'))).not.toContain('UC7005');
});

// ── quick fix: set @returns to the true inferred return type ──
const qfNewText = async (code) => {
  const path = `/tmp/jdt-qf-${n++}.uc`;
  const u = (await s.getDiagnostics(code, path) || []).find((d) => d.code === 'UC7005');
  if (!u) return null;
  const actions = (await s.getCodeActions(path, [u], u.range.start.line, u.range.start.character)) || [];
  const a = actions.find((x) => /Change @returns/.test(x.title));
  return a?.edit?.changes?.[`file://${path}`]?.[0]?.newText ?? null;
};
test('quick fix sets @returns to the inferred type for a single bad return', async () => {
  expect(await qfNewText('/** @returns {string} */\nfunction f(){ return 5; }\n')).toBe('{integer}');
});
test('quick fix offers the FULL inferred union across returns', async () => {
  expect(await qfNewText('/** @returns {string} */\nfunction f(x){ if(x) return "a"; return 5; }\n')).toBe('{string|integer}');
});
test('quick fix preserves null for a narrowed nullable return', async () => {
  expect(await qfNewText('/** @returns {string} */\nfunction f(){ return getenv("X"); }\n')).toBe('{string|null}');
});
test('quick fix on a no-return function suggests {null}', async () => {
  expect(await qfNewText('/** @returns {string} */\nfunction f(){ let t=1; }\n')).toBe('{null}');
});
