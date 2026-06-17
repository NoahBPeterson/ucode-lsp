// C1 — printf/sprintf validator rewrite (#49,#50,#51,#52,#53,#56,#88) + regex-flag hover.
// Behaviour verified against the ucode interpreter (uc_printf_common / lexer.c parse_regexp).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const fmt = async (code) => ((await s.getDiagnostics(code, `/tmp/c1t-${n++}.uc`)) || [])
  .filter(d => /printf|sprintf|specifier|format|conversion|effect|referenced|length modifier|dynamic|regex flag/i.test(d.message));
const codes = (ds) => ds.map(d => d.code).sort();

// ── #49 positional ──
test('positional %1$d / %2$s %1$s are valid (no false count error)', async () => {
  expect(await fmt('printf("%1$d", 5);\n')).toEqual([]);
  expect(await fmt('printf("%2$s %1$s", "a", "b");\n')).toEqual([]);
});
test('positional referencing a missing arg → UC2006', async () => {
  const ds = await fmt('printf("%2$s", "a");\n');
  expect(ds.length).toBe(1);
  expect(ds[0].code).toBe('UC2006');
  expect(ds[0].message).toMatch(/references argument 2/);
});
test('positional gap leaves an arg unreferenced → UC2006', async () => {
  const ds = await fmt('printf("%1$s %3$s", "a", "b", "c");\n');
  expect(ds.some(d => d.code === 'UC2006' && /argument 2 is not referenced/.test(d.message))).toBe(true);
});

// ── #50 / #51 / #52 unsupported C-isms → UC2011 ──
test("star width %*d → UC2011 (not a fabricated specifier)", async () => {
  const ds = await fmt('printf("%*d", 42);\n');
  expect(codes(ds)).toEqual(['UC2011']);
  expect(ds[0].message).toMatch(/'%\*d'/);
});
test('bogus conversion %a → UC2011 (was silently arg-consuming)', async () => {
  expect(codes(await fmt('printf("%a");\n'))).toEqual(['UC2011']);
  // %d still consumes its arg; only %a is flagged
  expect(codes(await fmt('printf("%d %a", 1);\n'))).toEqual(['UC2011']);
});
test('length modifier %lld → UC2011 with the full sequence quoted', async () => {
  const ds = await fmt('printf("%lld", 5);\n');
  expect(codes(ds)).toEqual(['UC2011']);
  expect(ds[0].message).toMatch(/'%lld'/); // full construct, not just '%l'
});

// ── #53 numeric-string coercion ──
test('numeric string to %d is accepted; non-numeric string literal is flagged', async () => {
  expect(await fmt('printf("%d", "42");\n')).toEqual([]);
  expect(await fmt('printf("%x", "255");\n')).toEqual([]);
  expect(codes(await fmt('printf("%d", "hello");\n'))).toEqual(['UC2007']);
});
test('a runtime (non-literal) string to %d is NOT flagged', async () => {
  expect(await fmt('let v = "a" + "b"; printf("%d", v);\n')).toEqual([]);
});

// ── #88 zero-arg useless call → UC2012 (was a hard error) ──
test('printf()/sprintf() with no args → UC2012 warning (not an error)', async () => {
  const p = await fmt('printf();\n');
  expect(codes(p)).toEqual(['UC2012']);
  expect(p[0].severity).toBe(2); // warning, not error
  expect(codes(await fmt('let x = sprintf();\n'))).toEqual(['UC2012']);
});

// ── #56 regex-flag cascade (lexer) ──
test('unsupported regex flag reports ONLY the flag error, no arg-count cascade', async () => {
  const pd = (await s.getDiagnostics('printf("%s", /a/m);\n', `/tmp/c1t-${n++}.uc`)) || [];
  expect(pd.length).toBe(1);
  expect(pd[0].message).toMatch(/Unsupported regex flag 'm'/);
  const md = (await s.getDiagnostics('match("a", /a/m);\n', `/tmp/c1t-${n++}.uc`)) || [];
  expect(md.length).toBe(1);
  expect(md[0].message).toMatch(/Unsupported regex flag 'm'/);
});

// ── regex-flag hover ──
test('hovering a regex flag explains the flags (ASCII-only, line-by-line for s)', async () => {
  const h = await s.getHover('let r = /a/gis;\n', `/tmp/c1t-${n++}.uc`, 0, 12);
  const v = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  expect(v).toBeTruthy();
  expect(v).toMatch(/match \*\*line by line\*\*|line by line/);
  expect(v).toMatch(/ignore case/);
  expect([...v].some(c => c.charCodeAt(0) > 127)).toBe(false); // no non-ASCII
});
