// #103 — every emitted diagnostic must carry a stable UC#### code. Previously the
// typeChecker / builtinValidation / parser paths pushed un-coded diagnostics; this
// pins down that they now all set `code`, reusing the existing registry codes.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

// First diagnostic whose message matches `needle`.
async function diag(code, needle) {
  const ds = (await s.getDiagnostics(code, `/tmp/dc-${n++}.uc`)) || [];
  return ds.find(d => d.message.includes(needle));
}

// ── typeChecker ──────────────────────────────────────────────────────────────
test('undefined function → UC1002', async () => {
  const d = await diag(`function f() { nope_xyz(); }\n`, 'Undefined function');
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC1002');
});

test('cannot call a non-function → UC2010', async () => {
  // calling a known-non-callable value (a parenthesised literal — a bare `5()`
  // path that resolves to the typeChecker's call-target check, not "undefined fn")
  const d = await diag(`(5)();\n`, 'Cannot call');
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC2010');
});

test('builtin arg-count (substr too few) → UC2003', async () => {
  const d = await diag(`substr("x");\n`, 'argument');
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC2003');
});

test('property on string type → UC5003', async () => {
  const d = await diag(`let s = "hi";\ns.length;\n`, 'does not exist on string');
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC5003');
});

test('property on array type → UC5003', async () => {
  const d = await diag(`let a = [1,2];\na.foo;\n`, 'does not exist on array');
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC5003');
});

test("'in' over a scalar → UC2009", async () => {
  const d = await diag(`let r = 1 in 2;\n`, "'in' over a");
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC2009');
});

// ── builtinValidation ────────────────────────────────────────────────────────
test('require() wrong arg-count → UC2003', async () => {
  const d = await diag(`let m = require("fs", "extra");\n`, 'require() expects');
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC2003');
});

// ── parser ───────────────────────────────────────────────────────────────────
test('parser error carries a code (UC6xxx umbrella)', async () => {
  const ds = (await s.getDiagnostics(`let x = ;\n`, `/tmp/dc-${n++}.uc`)) || [];
  const parseErr = ds.find(d => d.source === 'ucode-parser');
  expect(parseErr).toBeTruthy();
  expect(String(parseErr.code)).toMatch(/^UC6\d{3}$/);
});

test('missing semicolon → UC6003', async () => {
  const ds = (await s.getDiagnostics(`break\n`, `/tmp/dc-${n++}.uc`)) || [];
  const d = ds.find(x => x.source === 'ucode-parser' && /;/.test(x.message));
  expect(d).toBeTruthy();
  expect(d.code).toBe('UC6003');
});

// ── the invariant: NO diagnostic ships un-coded ──────────────────────────────
test('every diagnostic in a mixed file carries a code', async () => {
  const code = `let s = "hi";
function g() { undefined_fn_zzz(); }
s.length;
substr("x");
let r = 1 in 2;
`;
  const ds = (await s.getDiagnostics(code, `/tmp/dc-${n++}.uc`)) || [];
  expect(ds.length).toBeGreaterThan(0);
  const uncoded = ds.filter(d => d.code === undefined || d.code === null || d.code === '');
  expect(uncoded.map(d => d.message)).toEqual([]);
});
