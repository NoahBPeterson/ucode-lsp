// A terminator call (`die()`/`exit()`) inside a declaration/assignment initializer cuts control
// flow exactly like `die();` as a statement — it throws before the binding completes, so anything
// after is unreachable. cfgBuilder previously modelled the terminator only in the ExpressionStatement
// branch, so `let x = die(); print(y);` missed UC4001. (docs/done/cfg-terminator-in-initializer.md)
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const unreachable = async (code) =>
  ((await s.getDiagnostics(code, `/tmp/cfgterm-${n++}.uc`)) || []).filter((d) => d.code === 'UC4001').length;

test('parity: `die();` as a statement flags the following line', async () => {
  expect(await unreachable("function f() {\n  die('x');\n  print('after');\n}\n")).toBeGreaterThanOrEqual(1);
});

test('FIX: a terminator in a declarator init `let x = die();` flags the following line', async () => {
  expect(await unreachable("function g() {\n  let x = die('x');\n  print('after');\n}\n")).toBeGreaterThanOrEqual(1);
});

test('FIX: a terminator as an assignment RHS `x = die();` flags the following line', async () => {
  expect(await unreachable("function h() {\n  let x;\n  x = die('x');\n  print('after');\n}\n")).toBeGreaterThanOrEqual(1);
});

test('SOUND: a non-terminator init does NOT flag', async () => {
  expect(await unreachable("function k(y) {\n  let x = y();\n  print('after');\n}\n")).toBe(0);
});

test('SOUND: a CONDITIONAL terminator (`cond ? die() : y`) does NOT flag (not unconditional)', async () => {
  expect(await unreachable("function m(c) {\n  let x = c ? die() : 1;\n  print('after');\n}\n")).toBe(0);
});
