// #30 — uc()/lc() are total (stringify anything), so a non-string arg is not a hard error:
// a DEFINITE non-string → strict-gated warning + a "coerce to string" quick-fix. A union/null
// keeps the existing "possibly null" handling.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const diags = async (code, uri) => (await s.getDiagnostics(code, uri)) || [];
const coerceDiag = (ds) => ds.find(d => d.data && d.data.coerceToString);

test('uc(5) is a WARNING in non-strict (not a hard error)', async () => {
  const d = coerceDiag(await diags('uc(5);\n', '/tmp/uclc-a.uc'));
  expect(d).toBeTruthy();
  expect(d.severity).toBe(2); // warning
  expect(d.message).toMatch(/expects a string; integer will be coerced/);
});

test("uc(5) escalates to ERROR under 'use strict'", async () => {
  const d = coerceDiag(await diags("'use strict';\nuc(5);\n", '/tmp/uclc-b.uc'));
  expect(d).toBeTruthy();
  expect(d.severity).toBe(1); // error
});

test('lc and other definite non-strings (array/bool) also warn', async () => {
  expect(coerceDiag(await diags('lc(255);\n', '/tmp/uclc-c.uc'))).toBeTruthy();
  expect(coerceDiag(await diags('uc([1,2]);\n', '/tmp/uclc-d.uc'))).toBeTruthy();
  expect(coerceDiag(await diags('uc(true);\n', '/tmp/uclc-e.uc'))).toBeTruthy();
});

test('a real string argument is clean', async () => {
  const ds = await diags('uc("x"); let n = "y"; lc(n);\n', '/tmp/uclc-f.uc');
  expect(coerceDiag(ds)).toBeFalsy();
});

test('a string|null arg keeps the "possibly null" warning (not the coerce path)', async () => {
  const ds = await diags('function f(line){ let p = split(line,","); uc(p[5]); }\n', '/tmp/uclc-g.uc');
  expect(coerceDiag(ds)).toBeFalsy();                       // not the coerce diagnostic
  expect(ds.some(d => /possibly 'null'/.test(d.message))).toBe(true); // the null nudge instead
});

// ── the "Coerce to string" quick-fix ──
async function coerceFixEdit(code, uri) {
  const d = coerceDiag(await diags(code, uri));
  if (!d) return null;
  const acts = await s.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
  const a = (acts || []).find(x => x.title.includes('Coerce to string'));
  if (!a || !a.edit || !a.edit.changes) return null;
  const k = Object.keys(a.edit.changes)[0];
  return a.edit.changes[k][0].newText;
}

test('quick-fix wraps a simple arg without parens', async () => {
  expect(await coerceFixEdit('uc(5);\n', '/tmp/uclc-qf1.uc')).toBe('"" + 5');
});

test('quick-fix parenthesizes a binary / ternary arg (AST-based)', async () => {
  expect(await coerceFixEdit('uc(1 + 2);\n', '/tmp/uclc-qf2.uc')).toBe('"" + (1 + 2)');
  expect(await coerceFixEdit('function f(x){ return uc(x ? 1 : 2); }\n', '/tmp/uclc-qf3.uc')).toBe('"" + (x ? 1 : 2)');
});
