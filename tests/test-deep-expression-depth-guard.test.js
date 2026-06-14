// #117 — deeply-nested expressions must never crash the server. The recursive walkers
// (visitor `visit`, type-checker `checkNode`) have a depth guard that bails predictably at
// MAX_ANALYSIS_DEPTH (1000) before the native stack overflows; every traversal entry point is
// contained so an overflow in any OTHER walk (inlay hints, flow engine, …) degrades to a
// single "too deeply nested" warning instead of killing the process. The code is valid ucode
// (the interpreter runs these fine); only deep semantic analysis is skipped.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const diags = async (code) => (await s.getDiagnostics(code, `/tmp/depthguard-${n++}.uc`)) || [];
const chain = (k) => 'let x = ' + Array(k).fill('1').join('+') + '; print(x);\n';
const hasDeep = (ds) => ds.some((d) => /too deeply nested/i.test(d.message));
const hasRawOverflow = (ds) => ds.some((d) => /call stack|Maximum call stack/i.test(d.message));

// ── the graceful warning, never the raw crash ──
test('a 3000-term chain (old caught-overflow level) degrades to a warning', async () => {
  const ds = await diags(chain(3000));
  expect(hasDeep(ds)).toBe(true);
  expect(hasRawOverflow(ds)).toBe(false);
  expect(ds.find((d) => /too deeply nested/i.test(d.message)).severity).toBe(2); // Warning, not Error
});
test('an 8000-term chain (old server-KILL level) no longer crashes — server survives', async () => {
  expect(hasDeep(await diags(chain(8000)))).toBe(true);
  // server is still responsive afterwards:
  expect(Array.isArray(await diags('let a = 1; print(a);\n'))).toBe(true);
});
test('a 20000-term chain is contained', async () => {
  expect(hasRawOverflow(await diags(chain(20000)))).toBe(false);
  expect(Array.isArray(await diags('let a = 1; print(a);\n'))).toBe(true);
});

// ── other deep shapes recurse through different walkers; all must be contained ──
test('deeply nested parens / arrays / ternaries / unary do not crash', async () => {
  const shapes = [
    'let x = ' + '('.repeat(6000) + '1' + ')'.repeat(6000) + ';\n',
    'let x = ' + '['.repeat(6000) + '1' + ']'.repeat(6000) + ';\n',
    'let x = ' + '1?'.repeat(6000) + '1' + ':1'.repeat(6000) + ';\n',
    'let x = ' + '!'.repeat(6000) + '1;\n',
  ];
  for (const code of shapes) {
    expect(hasRawOverflow(await diags(code))).toBe(false);
  }
  expect(Array.isArray(await diags('let a = 1; print(a);\n'))).toBe(true); // alive
});

// ── normal code is completely unaffected ──
test('ordinary shallow expressions get no depth warning', async () => {
  const ds = await diags('function f(a, b) { return a + b * 2 - (1 + 1); }\nprint(f(1, 2));\n');
  expect(hasDeep(ds)).toBe(false);
  expect(hasRawOverflow(ds)).toBe(false);
});
test('a moderately deep but reasonable chain (200 terms) is analyzed normally', async () => {
  expect(hasDeep(await diags(chain(200)))).toBe(false);
});
