// invalid-escape-uc6013: the lexer's escape switch had `default: value += escaped` —
// ANY unknown escape passed through with no validation, in strings AND templates.
// ucode's parse_escape (ucode/lexer.c) requires `\u` + EXACTLY 4 hex digits (the ES6
// `\u{1234}` form does not exist), `\x` + exactly 2, and caps octal escapes at \377 —
// violations are "Invalid escape sequence" compile errors. Errors ride the lexer
// side-channel (like unsupported regex flags, #56) so a valid string token is still
// emitted and no cascade follows. The decoder also now yields real values for
// \uXXXX/\xXX/octal/\a\b\e\f\v (paired surrogates combine in UTF-16).
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/invalid-escape-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const invalid = async (code) => (await diags(code)).filter((d) => d.code === 'UC6013');

// ── must flag (ucode: "Invalid escape sequence") ─────────────────────────────
test('ES6 \\u{1234} form is an error (the m00qek repro)', async () => {
  const ds = await invalid('printf(`\\uXXXX only; no \\u{1234} allowed`);\n');
  // \uXXXX: X is not a hex digit → error; \u{…}: { is not a hex digit → error
  expect(ds.length).toBe(2);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('Invalid escape sequence');
});
test('\\u with too few hex digits is an error', async () => {
  expect((await invalid('let s = "\\u12";\nprint(s);\n')).length).toBe(1);
});
test('\\u with a non-hex character mid-run is an error', async () => {
  expect((await invalid('let s = "\\u12g4";\nprint(s);\n')).length).toBe(1);
});
test('\\x with fewer than 2 hex digits is an error', async () => {
  expect((await invalid('let s = "\\xZ";\nprint(s);\n')).length).toBe(1);
});
test('octal escape above \\377 is an error', async () => {
  expect((await invalid('let s = "\\400";\nprint(s);\n')).length).toBe(1);
});
test('invalid escape in a single-quoted string is an error too', async () => {
  expect((await invalid("let s = '\\u{FF}';\nprint(s);\n")).length).toBe(1);
});

// ── must stay clean (valid ucode) + decode correctly ─────────────────────────
test('\\u1234, \\x41, \\101, and letter escapes stay clean', async () => {
  const code = 'let s = "\\u1234 \\x41 \\101 \\n \\t \\a \\e \\377";\nprint(s);\n';
  expect((await invalid(code)).length).toBe(0);
});
test('template with valid escapes stays clean', async () => {
  expect((await invalid('let x = 1;\nlet s = `ok \\u0041 ${x} \\x42`;\nprint(s);\n')).length).toBe(0);
});
test('paired surrogate halves are valid (combine per ucode)', async () => {
  expect((await invalid('let s = "\\ud83d\\ude00";\nprint(s);\n')).length).toBe(0);
});
test('unpaired surrogate half is NOT an error (ucode substitutes U+FFFD)', async () => {
  expect((await invalid('let s = "\\ud800 alone";\nprint(s);\n')).length).toBe(0);
});
test('unknown letter escapes pass through silently (ucode default)', async () => {
  expect((await invalid('let s = "\\q \\z \\- \\\'";\nprint(s);\n')).length).toBe(0);
});
test('regex escapes are untouched (\\d etc. stay clean)', async () => {
  expect((await invalid('let re = /\\d+\\w*/;\nprint(re);\n')).length).toBe(0);
});

// ── recovery: side-channel keeps the token valid, no cascade ─────────────────
test('a bad escape does not derail the rest of the file', async () => {
  const ds = await diags('let s = "\\u{1}";\nlet t = "fine";\nprint(s, t);\nlet z = undefined_thing;\n');
  expect(ds.filter((d) => d.code === 'UC6013').length).toBe(1);
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
  // the string token survived — no unterminated-string or parse cascade
  expect(ds.some((d) => /Unterminated/.test(d.message))).toBe(false);
});
test('bad escape inside a call argument does not break arg counting', async () => {
  const ds = await diags('printf("%s\\u{X}", "v");\n');
  expect(ds.filter((d) => d.code === 'UC6013').length).toBe(1);
  expect(ds.some((d) => d.code === 'UC2006')).toBe(false); // no phantom arg-count error
});
