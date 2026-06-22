// #32 — match(subject, pattern) is asymmetric:
//   arg 1 (subject) is coerced to a string  → warn (error under 'use strict') + coerce quick-fix
//   arg 2 (pattern) must be a regex; a non-regex returns null silently → hard error
//                   + a "convert string to regex literal" quick-fix
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const diags = async (code, uri) => (await s.getDiagnostics(code, uri)) || [];

// ── arg 1 (subject): coercion ──
test('match(123, /2/) — non-string subject warns (coerce), not a hard error', async () => {
  const ds = await diags('match(123, /2/);\n', '/tmp/m-a.uc');
  const d = ds.find(x => x.data?.coerceToString);
  expect(d).toBeTruthy();
  expect(d.severity).toBe(2);
});

test("match subject escalates to error under 'use strict'", async () => {
  const ds = await diags("'use strict';\nmatch(123, /2/);\n", '/tmp/m-b.uc');
  const d = ds.find(x => x.data?.coerceToString);
  expect(d && d.severity).toBe(1);
});

test('match("x", /2/) — string subject is clean', async () => {
  const ds = await diags('match("x", /2/);\n', '/tmp/m-c.uc');
  expect(ds.some(d => /match/.test(d.message))).toBe(false);
});

test('match subject coerce quick-fix wraps the arg', async () => {
  const uri = '/tmp/m-qf.uc';
  const ds = await diags('match(123, /2/);\n', uri);
  const d = ds.find(x => x.data?.coerceToString);
  const acts = await s.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
  const a = (acts || []).find(x => x.title.includes('Coerce to string'));
  expect(a).toBeTruthy();
  const k = Object.keys(a.edit.changes)[0];
  expect(a.edit.changes[k][0].newText).toBe('"" + 123');
});

// ── arg 2 (pattern): must be a regex ──
test('match(s, "[0-9]") — string pattern is a hard ERROR (never matches in ucode)', async () => {
  const ds = await diags('match("a1b", "[0-9]");\n', '/tmp/m-d.uc');
  const d = ds.find(x => x.data?.convertStringToRegex);
  expect(d).toBeTruthy();
  expect(d.severity).toBe(1); // error
});

test('string-pattern quick-fix converts from SOURCE text (escapes preserved, slashes escaped)', async () => {
  for (const [code, expected] of [
    ['match("a1b", "[0-9]");\n', '/[0-9]/'],
    ['match("p", "a/b");\n', '/a\\/b/'],
    // \b in the SOURCE is preserved (not decoded to a backspace as the value would be)
    ['match("p", "a\\b");\n', '/a\\b/'],
  ]) {
    const uri = `/tmp/m-r-${n++}.uc`;
    const ds = await diags(code, uri);
    const d = ds.find(x => x.data?.convertStringToRegex);
    const acts = await s.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const a = (acts || []).find(x => x.title.includes('Convert to regex'));
    expect(a).toBeTruthy();
    const k = Object.keys(a.edit.changes)[0];
    expect(a.edit.changes[k][0].newText).toBe(expected);
  }
});

test('match(true, /x/) offers ONLY the coerce fix — never a bogus type guard', async () => {
  const uri = '/tmp/m-noguard.uc';
  const ds = await diags('match(true, /x/);\n', uri);
  const d = ds.find(x => x.data?.coerceToString);
  expect(d).toBeTruthy();
  const acts = await s.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
  const titles = (acts || []).map(a => a.title);
  expect(titles.some(t => t.includes('Coerce to string'))).toBe(true);
  expect(titles.some(t => /type guard|Extract/i.test(t))).toBe(false); // no narrowing guard for a singular type
});

test('match(s, /ok/) — regex pattern is clean', async () => {
  const ds = await diags('match("x", /ok/);\n', '/tmp/m-e.uc');
  expect(ds.some(d => /match/.test(d.message))).toBe(false);
});
