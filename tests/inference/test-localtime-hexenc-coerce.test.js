// #35 hexenc — stringifies any value (like uc/lc) → non-string is a coercion warning + fix, NOT
//   an error. b64enc stays strict (it genuinely rejects non-strings → null).
// #34 localtime/gmtime — coerce the epoch to int (ucv_to_integer): a numeric string is fine; a
//   statically non-numeric value silently becomes 0 (1970) → strict-gated warning, never an error.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const diags = async (code, uri) => (await s.getDiagnostics(code, uri)) || [];
const find = (ds, re) => ds.find(d => re.test(d.message));

// ── #35 hexenc ──
test('hexenc(123) — coercion warning + coerce quick-fix (not an error)', async () => {
  const uri = '/tmp/he-a.uc';
  const ds = await diags('hexenc(123);\n', uri);
  const d = ds.find(x => x.data?.coerceToString);
  expect(d).toBeTruthy();
  expect(d.severity).toBe(2);
  const acts = await s.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
  expect((acts || []).some(a => a.title.includes('Coerce to string'))).toBe(true);
});

test("hexenc(123) escalates to error under 'use strict'", async () => {
  const d = (await diags("'use strict';\nhexenc(123);\n", '/tmp/he-b.uc')).find(x => x.data?.coerceToString);
  expect(d && d.severity).toBe(1);
});

test('hexenc([1]) coerces; hexenc("x") is clean', async () => {
  expect((await diags('hexenc([1]);\n', '/tmp/he-c.uc')).some(d => d.data?.coerceToString)).toBe(true);
  expect((await diags('hexenc("x");\n', '/tmp/he-d.uc')).some(d => /hexenc/.test(d.message))).toBe(false);
});

test('b64enc(123) stays a hard error (it is NOT total — returns null)', async () => {
  const d = find(await diags('b64enc(123);\n', '/tmp/he-e.uc'), /b64enc/);
  expect(d).toBeTruthy();
  expect(d.severity).toBe(1);              // error
  expect(d.data?.coerceToString).toBeFalsy(); // no coerce fix
});

// ── #34 localtime / gmtime ──
test('localtime("123") — numeric string is accepted (the old false positive)', async () => {
  expect((await diags('localtime("123");\n', '/tmp/lt-a.uc')).some(d => /localtime/.test(d.message))).toBe(false);
});

test('localtime(123) and localtime() are clean', async () => {
  expect((await diags('localtime(123);\n', '/tmp/lt-b.uc')).some(d => /localtime/.test(d.message))).toBe(false);
  expect((await diags('localtime();\n', '/tmp/lt-c.uc')).some(d => /localtime/.test(d.message))).toBe(false);
});

test('localtime("abc") — non-numeric string literal warns (error under strict), never a hard error in non-strict', async () => {
  const d = find(await diags('localtime("abc");\n', '/tmp/lt-d.uc'), /localtime/);
  expect(d).toBeTruthy();
  expect(d.severity).toBe(2);
  const ds = await diags("'use strict';\nlocaltime(\"abc\");\n", '/tmp/lt-e.uc');
  expect(find(ds, /localtime/).severity).toBe(1);
});

test('localtime([1]) (non-numeric type) warns; gmtime mirrors localtime', async () => {
  expect(find(await diags('localtime([1]);\n', '/tmp/lt-f.uc'), /localtime/).severity).toBe(2);
  expect(find(await diags('gmtime("abc");\n', '/tmp/lt-g.uc'), /gmtime/).severity).toBe(2);
});

test('gmtime(runtimeValue) is clean (could be numeric at runtime)', async () => {
  expect((await diags('function f(x){ gmtime(x); }\n', '/tmp/lt-h.uc')).some(d => /gmtime/.test(d.message))).toBe(false);
});
