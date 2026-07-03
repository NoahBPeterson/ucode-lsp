// escape-hover: hovering a \-escape inside a string/template literal shows the
// character it decodes to. Decoding goes through the SAME decodeEscape the lexer
// uses (0.7.45's UC6013 machinery), so hover and diagnostics can never disagree.
// Paired \uD8xx\uDCxx surrogate halves combine — hovering either half shows the
// full astral character; regex literals are excluded (\d there is regex semantics).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/escape-hover-${n++}.uc`;
const hoverAt = async (code, line, character) => {
  const h = await server.getHover(code, uri(), line, character);
  return h && h.contents ? h.contents.value : null;
};

// ── decoded characters ────────────────────────────────────────────────────────
test('\\u1234 hover shows the decoded character and codepoint', async () => {
  //            0123456789012345678
  const code = 'let s = "ab\\u1234cd";\nprint(s);\n';
  const md = await hoverAt(code, 0, 12); // on the 'u'
  expect(md).toContain('\\u1234');
  expect(md).toContain('ሴ');
  expect(md).toContain('U+1234');
});
test('\\x41 hover shows A', async () => {
  const code = 'let s = "pre\\x41post";\nprint(s);\n';
  const md = await hoverAt(code, 0, 13);
  expect(md).toContain('`A`');
  expect(md).toContain('U+0041');
});
test('octal \\101 hover shows A', async () => {
  const code = 'let s = "pre\\101post";\nprint(s);\n';
  const md = await hoverAt(code, 0, 14);
  expect(md).toContain('`A`');
  expect(md).toContain('U+0041');
});
test('\\n hover names the control character instead of printing it', async () => {
  const code = 'let s = "one\\ntwo";\nprint(s);\n';
  const md = await hoverAt(code, 0, 12);
  expect(md).toContain('LF (newline)');
  expect(md).toContain('U+000A');
});
test('\\e hover names ESC', async () => {
  const code = 'let s = "x\\e[0m";\nprint(s);\n';
  const md = await hoverAt(code, 0, 11);
  expect(md).toContain('ESC (escape)');
  expect(md).toContain('U+001B');
});

// ── surrogate pairs ───────────────────────────────────────────────────────────
test('hovering the HIGH half of a pair shows the combined character', async () => {
  const code = 'let s = "\\ud83d\\ude00";\nprint(s);\n';
  const md = await hoverAt(code, 0, 10);
  expect(md).toContain('\u{1F600}');
  expect(md).toContain('U+1F600');
  expect(md).toContain('surrogate pair');
});
test('hovering the LOW half of a pair shows the combined character too', async () => {
  const code = 'let s = "\\ud83d\\ude00";\nprint(s);\n';
  const md = await hoverAt(code, 0, 17);
  expect(md).toContain('U+1F600');
});
test('unpaired high surrogate explains the U+FFFD substitution', async () => {
  const code = 'let s = "\\ud800 alone";\nprint(s);\n';
  const md = await hoverAt(code, 0, 10);
  expect(md).toContain('unpaired surrogate half');
  expect(md).toContain('U+FFFD');
});

// ── other escape kinds ────────────────────────────────────────────────────────
test('unknown escape notes the pass-through', async () => {
  const code = 'let s = "a\\qb";\nprint(s);\n';
  const md = await hoverAt(code, 0, 11);
  expect(md).toContain('`q`');
  expect(md).toContain('passes the character through');
});
test('invalid escape hover explains the error', async () => {
  const code = 'let s = "a\\u{12}b";\nprint(s);\n';
  const md = await hoverAt(code, 0, 11);
  expect(md).toContain('invalid escape sequence');
  expect(md).toContain('4 hex digits');
});
test('escapes hover inside template literals as well', async () => {
  const code = 'let x = 1;\nlet s = `ok \\u0041 ${x}`;\nprint(s);\n';
  const md = await hoverAt(code, 1, 13);
  expect(md).toContain('`A`');
  expect(md).toContain('U+0041');
});

// ── must NOT fire ────────────────────────────────────────────────────────────
test('plain text inside a string produces no escape hover', async () => {
  const code = 'let s = "plain text";\nprint(s);\n';
  const md = await hoverAt(code, 0, 12);
  expect(md === null || !/U\+[0-9A-F]{4}/.test(md)).toBe(true);
});
test('regex escapes (\\d) get no character hover', async () => {
  const code = 'let re = /a\\d+/;\nprint(re);\n';
  const md = await hoverAt(code, 0, 12);
  expect(md === null || !md.includes('U+0064')).toBe(true);
});
test('identifier hover still works (feature does not swallow normal hovers)', async () => {
  const code = 'let count = 5;\nprint(count);\n';
  const md = await hoverAt(code, 1, 8);
  expect(md).toContain('integer');
});
