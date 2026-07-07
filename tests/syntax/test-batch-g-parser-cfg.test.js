// Batch G — parser + CFG fixes. Each ticket's runtime-syntax claim was verified against the
// vendored ucode/ucode binary and/or ucode C source (compiler.c). See docs/auto-docs/.
//
//  57  `while (true) {}` must be treated as never-completing (dead code after it flagged).
//  60  a for-loop update (`i++`) must NOT be flagged unreachable when the body always breaks.
//  109 a broken initializer (`let x = (1 +;`) must NOT cascade a UC1006 "unused" on top.
//  118 a pathologically deep paren nest must give one clean diagnostic, not a confusing cascade.
//  152 `for (i = 0, j = 0; …)` — comma (sequence) operator is legal in the for-initializer.
//  153 a value-less `return }` / `return`-at-EOF IS a ucode syntax error and must be flagged.
//  82  `let café = 1;` — a non-ASCII identifier char reports the lexer's "Unexpected character"
//      once, with no misleading "Expected ';'" cascade.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/batchg-${n++}.uc`) || []);
const codes = (ds) => ds.map((d) => d.code);
const has = (ds, code) => ds.some((d) => d.code === code);

// ── 57: while(true) is never-completing ──────────────────────────────────────
test('57 code after `while (true) {}` (no break) is unreachable', async () => {
  const ds = await diags('while (true) { x = 1; }\nprint("dead");\n');
  expect(has(ds, 'UC4001')).toBe(true);
});
test('57 `while (1) {}` is likewise never-completing', async () => {
  expect(has(await diags('while (1) { x = 1; }\nprint("dead");\n'), 'UC4001')).toBe(true);
});
test('57 a `break` restores the exit — code after is reachable', async () => {
  const ds = await diags('while (true) { break; }\nprint("live");\n');
  expect(has(ds, 'UC4001')).toBe(false);
});
test('57 a fallible while condition still exits normally (no false unreachable)', async () => {
  expect(has(await diags('let x = 0;\nwhile (x < 3) { x++; }\nprint("live");\n'), 'UC4001')).toBe(false);
});

// ── 60: loop update not "unreachable" when body always exits ──────────────────
test('60 `for (…; …; i++) { break; }` does not flag the i++ update', async () => {
  expect(has(await diags('for (let i = 0; i < 3; i++) { break; }\n'), 'UC4001')).toBe(false);
});
test('60 `for (…; …; i++) { return; }` inside a fn does not flag the update', async () => {
  const ds = await diags('function f() {\n  for (let i = 0; i < 3; i++) { return 1; }\n}\nf();\n');
  expect(has(ds, 'UC4001')).toBe(false);
});
test('60 a `continue` still lets the update be analyzed (reachable, no FP)', async () => {
  expect(has(await diags('for (let i = 0; i < 3; i++) { continue; }\n'), 'UC4001')).toBe(false);
});
test('60 genuine dead code after a break inside the body is STILL flagged', async () => {
  const ds = await diags('for (let i = 0; i < 3; i++) { break; print("dead"); }\n');
  expect(has(ds, 'UC4001')).toBe(true);
});

// ── 109: broken initializer must not cascade UC1006 ──────────────────────────
test('109 `let x = (1 +;` flags the parse error but NOT "unused x"', async () => {
  const ds = await diags('let x = (1 +;\n');
  expect(has(ds, 'UC6001')).toBe(true);   // the real syntax error
  expect(has(ds, 'UC1006')).toBe(false);  // no misleading "unused"
});
test('109 `let a = {b: };` does not cascade UC1006', async () => {
  expect(has(await diags('let a = {b: };\n'), 'UC1006')).toBe(false);
});
test('109 a legitimately unused `let y;` (no init) is still flagged UC1006', async () => {
  expect(has(await diags('let y;\n'), 'UC1006')).toBe(true);
});

// ── 118: deep paren nesting → one clean diagnostic, no crash ──────────────────
test('118 2500 nested parens yields a single clear "too deeply nested" error', async () => {
  const code = 'let x = ' + '('.repeat(2500) + '1' + ')'.repeat(2500) + ';\n';
  const ds = await diags(code);
  expect(ds.some((d) => /too deeply nested/i.test(d.message))).toBe(true);
  // No confusing secondary "Expected ';'" / "unused" cascade.
  expect(ds.filter((d) => d.severity === 1).length).toBe(1);
  expect(has(ds, 'UC1006')).toBe(false);
});
test('118 a modestly nested expression still parses cleanly', async () => {
  const code = 'let x = ' + '('.repeat(50) + '1' + ')'.repeat(50) + ';\nprint(x);\n';
  expect((await diags(code)).filter((d) => d.severity === 1)).toEqual([]);
});

// ── 152: comma operator in for-initializer ───────────────────────────────────
test('152 `for (i = 0, j = 0; …)` parses cleanly', async () => {
  const ds = await diags('let i, j;\nfor (i = 0, j = 0; i < 2; i++) print(i);\n');
  expect(ds.filter((d) => d.severity === 1)).toEqual([]);
});
test('152 no "after for loop initializer" error for a comma init', async () => {
  const ds = await diags('let i, j;\nfor (i = 0, j = 0; i < 2; i++) print(i);\n');
  expect(ds.some((d) => /for loop initializer/.test(d.message))).toBe(false);
});

// ── 153: value-less return before `}` / EOF is an error ──────────────────────
test('153 `return }` (no value) is flagged', async () => {
  expect((await diags('function f() { return }\nf();\n')).some((d) => /after .return./.test(d.message))).toBe(true);
});
test('153 `return;` and `return 1 }` are both clean', async () => {
  expect((await diags('function g(){ return; }\ng();\n')).some((d) => /after .return./.test(d.message))).toBe(false);
  expect((await diags('function h(){ return 1 }\nh();\n')).some((d) => /after .return./.test(d.message))).toBe(false);
});

// ── 82: non-ASCII identifier char — single clean lexer error, no cascade ──────
test('82 `let café = 1;` reports "Unexpected character" once, no "Expected \';\'" cascade', async () => {
  const ds = await diags('let café = 1;\nprint(café);\n');
  expect(ds.some((d) => /Unexpected character/.test(d.message))).toBe(true);
  expect(ds.some((d) => /Expected ';' after variable declaration/.test(d.message))).toBe(false);
});
