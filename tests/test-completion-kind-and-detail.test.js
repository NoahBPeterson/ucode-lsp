// #101 — ambient constants get CompletionItemKind.Constant (not Variable).
// #102 — builtin completion `detail` carries a compact signature, not a generic label.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

// CompletionItemKind: 3 = Function, 6 = Variable, 21 = Constant
const KIND = { Function: 3, Variable: 6, Constant: 21 };

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

async function item(code, ch, label) {
  const c = await s.getCompletions(code, `/tmp/ckd-${n++}.uc`, 0, ch);
  const items = Array.isArray(c) ? c : (c && c.items) || [];
  return items.find(i => i.label === label);
}

// ── #101: ambient constants render as constants ──
test('NaN / Infinity / REQUIRE_SEARCH_PATH are CompletionItemKind.Constant', async () => {
  for (const name of ['NaN', 'Infinity', 'REQUIRE_SEARCH_PATH']) {
    const it = await item('let x = \n', 8, name);
    expect(it).toBeTruthy();
    expect(it.kind).toBe(KIND.Constant);
    expect(it.detail).toBe('constant');
  }
});

test('ARGV stays a Variable (constants change is scoped, not blanket)', async () => {
  const it = await item('let x = \n', 8, 'ARGV');
  expect(it).toBeTruthy();
  expect(it.kind).toBe(KIND.Variable);
});

// ── #102: builtin detail is a compact signature ──
test('printf detail is a compact signature, not the generic label', async () => {
  const it = await item('let x = \n', 8, 'printf');
  expect(it).toBeTruthy();
  expect(it.kind).toBe(KIND.Function);
  expect(it.detail).toBe('printf(format, ...args)');
});

test('substr / length details carry their parameter lists', async () => {
  expect((await item('let x = \n', 8, 'substr')).detail).toBe('substr(string, start, length)');
  expect((await item('let x = \n', 8, 'length')).detail).toBe('length(x)');
});

test('a builtin whose doc has no parameter signal keeps the generic detail (no fake "()")', async () => {
  // `time` documents no **Parameters:** block and no leading signature → we do NOT
  // fabricate `time()`; it stays generic. (Guards constants mis-listed as functions.)
  const it = await item('let x = \n', 8, 'time');
  expect(it).toBeTruthy();
  expect(it.detail).toBe('built-in function');
});
