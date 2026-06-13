// False-positive cluster (auto-docs #29, #76, #58, #11). Each verified vs the
// ucode interpreter / per-release oracles:
//   #29 — a variable used only via spread (`...a`) must not be UC1006 "never used".
//   #76 — `in` over a provably-non-collection RHS is always-false (error w/ accurate
//         message); an object|null / unknown RHS must stay clean.
//   #58 — reassigning the for-in iteratee to a fresh array is not an infinite loop;
//         UC4005 is skipped on unconditional rebind, not escalated on conditional.
//   #11 — `import { default as X }` / `export { x as default }` are valid on every
//         ucode version (oracle-confirmed) and must parse without error.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, n = 0;
beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  // Fixture module for the #11 import test (so module resolution succeeds and the
  // only thing under test is the `default`-specifier parse + symbol binding).
  fs.writeFileSync('/tmp/fpc-mod.uc', 'function a(){ return 7; }\nexport { a as default };\n');
});
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/fpc-${n++}.uc`) || []);
const errs = (ds) => ds.filter((x) => x.severity === 1);
const warns = (ds) => ds.filter((x) => x.severity === 2);
const codes = (ds) => ds.map((x) => x.code || '(none)');
const msgs = (ds) => ds.map((x) => x.message);

// ── #29 spread counts as a use ───────────────────────────────────────────────
test('29 object spread marks the variable used (no UC1006)', async () => {
  expect(codes(await diags('let a = {x:1}; let b = {...a, y:2}; print(b.y);\n'))).not.toContain('UC1006');
});
test('29 array spread marks the variable used (no UC1006)', async () => {
  expect(codes(await diags('let a = [1,2]; let b = [...a, 3]; print(b[0]);\n'))).not.toContain('UC1006');
});
test('29 call spread marks the variable used (no UC1006)', async () => {
  expect(codes(await diags('function f(...r){return r;} let a=[1,2]; let b=f(...a); print(b);\n'))).not.toContain('UC1006');
});
test('29 a genuinely-unused var is still flagged UC1006 (regression guard)', async () => {
  expect(codes(await diags('let unused = 5; print("hi");\n'))).toContain('UC1006');
});

// ── #76 `in` over a scalar ───────────────────────────────────────────────────
test('76 `x in "string"` is an error with an accurate always-false message', async () => {
  const e = errs(await diags('let r = ("x" in "hello");\n'));
  expect(e.length).toBe(1);
  expect(e[0].message).toMatch(/always false/);
});
test('76 `2 in <integer>` is flagged', async () => {
  expect(errs(await diags('let n = 5; let r = (2 in n);\n')).length).toBe(1);
});
test('76 `x in <object|null>` (defensive idiom) is NOT flagged', async () => {
  const code = 'function f(o){ if (type(o) == "object" || o == null) return ("k" in o); }\n';
  const e = errs(await diags(code));
  expect(e.filter((x) => /in/.test(x.message) && /always false|requires/.test(x.message)).length).toBe(0);
});
test('76 `x in <unknown param>` is NOT flagged', async () => {
  const e = errs(await diags('function f(o){ return ("k" in o); }\n'));
  expect(e.filter((x) => /always false|requires object or array/.test(x.message)).length).toBe(0);
});

// ── #58 reassigned iteratee is not an infinite loop ──────────────────────────
test('58 unconditional rebind of the iteratee: no UC4005 at all', async () => {
  const code = 'let a = [1,2,3];\nfor (x in a) { a = []; push(a, x); }\n';
  expect(codes(await diags(code))).not.toContain('UC4005');
});
test('58 conditional rebind: UC4005 is not escalated to Error', async () => {
  const code = 'let a = [1,2,3];\nfor (x in a) { if (x > 1) a = []; push(a, x); }\n';
  const ds = await diags(code);
  expect(errs(ds).map((x) => x.code)).not.toContain('UC4005'); // not an Error
});
test('58 growing the actual iteratee (no rebind) is still flagged Error (regression guard)', async () => {
  const code = 'let a = [1,2,3];\nfor (x in a) { push(a, x); }\n';
  expect(errs(await diags(code)).map((x) => x.code)).toContain('UC4005');
});

// ── #11 `default` keyword in brace specifiers ────────────────────────────────
test('11 `import { default as Foo }` parses and binds Foo (no parse error / undefined)', async () => {
  const code = 'import { default as Foo } from "/tmp/fpc-mod.uc";\nprint(Foo());\n';
  const m = msgs(await diags(code));
  expect(m.some((x) => /Expected identifier/.test(x))).toBe(false);
  expect(m.some((x) => /Undefined (function|variable): Foo/.test(x))).toBe(false);
});
test('11 `import { default as X, y }` (mixed) parses', async () => {
  const code = 'import { default as X, y } from "/tmp/fpc-mod.uc";\nprint(X, y);\n';
  expect(msgs(await diags(code)).some((x) => /Expected identifier/.test(x))).toBe(false);
});
test('11 `export { a as default }` parses without error', async () => {
  const code = 'function a(){ return 7; }\nexport { a as default };\n';
  expect(msgs(await diags(code)).some((x) => /Expected identifier/.test(x))).toBe(false);
});
