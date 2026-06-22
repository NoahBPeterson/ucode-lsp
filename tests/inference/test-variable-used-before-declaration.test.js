// Finding #17 — use of a `let`/`const` before its declaration.
//
// Verified vs the ucode oracle: let/const are block-scoped and NOT hoisted; even a
// closure that references a let declared later does not bind to it (strict: "access to
// undeclared variable"; non-strict: reads null → usually a downstream type error). There
// is NO valid forward-reference idiom for let/const, so flagging is always sound.
//
// The diagnostic must DISCRIMINATE by scope:
//   • reachable forward reference (same/enclosing block, declared later) → UC1011
//     "used before its declaration" (and the declaration counts as used → no UC1006).
//   • a reference to a declaration in a scope it can't reach (sibling/inner block, a
//     block that already closed, a loop var read after the loop) → plain UC1001.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/ubd-${n++}.uc`) || []);
const codes = (ds) => ds.map((x) => x.code || '(none)');

// ── reachable forward references → UC1011, and no contradictory UC1006 ───────
test('const used before its declaration (same scope) → UC1011', async () => {
  const c = codes(await diags('print(C);\nconst C = 5;\n'));
  expect(c).toContain('UC1011');
  expect(c).not.toContain('UC1001');
});
test('the contradictory UC1006 "never used" is gone', async () => {
  expect(codes(await diags('print(C);\nconst C = 5;\n'))).not.toContain('UC1006');
});
test('let used before its declaration (same scope) → UC1011', async () => {
  expect(codes(await diags('function f(){ let y = x; let x = 5; return y; }\nprint(f());\n'))).toContain('UC1011');
});
test('closure references a let declared later → UC1011', async () => {
  const code = 'function outer(){\n  function g(){ return x; }\n  let x = 42;\n  return g();\n}\nprint(outer());\n';
  expect(codes(await diags(code))).toContain('UC1011');
});

// ── references to scopes that are NOT reachable → plain UC1001, never UC1011 ──
test('let escaping an if-block → UC1001 (out of scope, not before-decl)', async () => {
  const c = codes(await diags('if (true) { let x = 1; }\nprint(x);\n'));
  expect(c).toContain('UC1001');
  expect(c).not.toContain('UC1011');
});
test('let escaping a bare block → UC1001', async () => {
  expect(codes(await diags('{ let y = 5; }\nprint(y);\n'))).toContain('UC1001');
});
test('sibling-block variable → UC1001', async () => {
  expect(codes(await diags('{ let a = 1; }\n{ print(a); }\n'))).toContain('UC1001');
});
test('use that PRECEDES a sibling/inner block decl → UC1001, not UC1011', async () => {
  const c = codes(await diags('print(a);\n{ let a = 1; }\n'));
  expect(c).toContain('UC1001');
  expect(c).not.toContain('UC1011');
});
test('for-loop let read after the loop → UC1001 (non-strict; was a false negative)', async () => {
  const c = codes(await diags('for (let i = 0; i < 1; i++) {}\nprint(i);\n'));
  expect(c).toContain('UC1001');
  expect(c).not.toContain('UC1011');
});
test('for-loop let read after the loop → UC1001 (strict too)', async () => {
  expect(codes(await diags("'use strict';\nfor (let i = 0; i < 1; i++) {}\nprint(i);\n"))).toContain('UC1001');
});

// ── valid code stays clean; function forward refs unchanged ───────────────────
test('declare-then-use is clean', async () => {
  expect(await diags('const C = 5;\nprint(C);\n')).toEqual([]);
});
test('outer var used in an inner block is clean', async () => {
  expect(await diags('let x = 1;\n{ print(x); }\n')).toEqual([]);
});
test('a real for-loop counter used inside its body is clean', async () => {
  expect(await diags('for (let i = 0; i < 3; i++) { print(i); }\n')).toEqual([]);
});
test('function used before its declaration still → UC1009 (unchanged)', async () => {
  expect(codes(await diags('g();\nfunction g(){ return 1; }\n'))).toContain('UC1009');
});
