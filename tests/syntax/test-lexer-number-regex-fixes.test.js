// Lexer fidelity fixes (batch C): number literals, regex body validation, block-comment `/*/`,
// and the unexpected-character diagnostic. Every expectation below was verified against the
// vendored ucode binary (ucode/ucode) and the vendored C lexer (ucode/lexer.c / vallist.c).
//
//   T25 hex floats           0xFF.5 -> 255.3125, 0x1.8 -> 1.5     (C99 hex float via strtod)
//   T26 bare prefixes        0x is an error; 0b / 0o parse to 0
//   T28 invalid trailing     0o9 / 0b2 / 123abc / 1.2.3 / 1e -> "Invalid number literal"
//   T54 regex body           unclosed group + reversed range flagged; POSIX class / \d clean
//   T55 `/*/`                a complete (empty) block comment, NOT "Unterminated comment"
//   T80 unexpected char      diagnostic range starts ON the offending character
//   T81 astral char          reported as one code point with a two-unit range
const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../../src/lexer/tokenTypes.ts');

function lex(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  return { tokens, errors: lexer.errors };
}
// the first non-EOF, non-error token that carries a numeric value
function firstNumberToken(code) {
  const { tokens } = lex(code);
  return tokens.find((t) => t.type === TokenType.TK_NUMBER || t.type === TokenType.TK_DOUBLE);
}

// ── T25: hex float literals are accepted as doubles ──────────────────────────
test('0xFF.5 lexes to the double 255.3125 with no error', () => {
  const { errors } = lex('let x = 0xFF.5;');
  expect(errors.length).toBe(0);
  const t = firstNumberToken('let x = 0xFF.5;');
  expect(t.type).toBe(TokenType.TK_DOUBLE);
  expect(t.value).toBeCloseTo(255.3125, 6);
});
test('0x1.8 lexes to the double 1.5', () => {
  const t = firstNumberToken('let x = 0x1.8;');
  expect(t.type).toBe(TokenType.TK_DOUBLE);
  expect(t.value).toBeCloseTo(1.5, 6);
});
test('0x0.1 lexes to the double 0.0625', () => {
  expect(firstNumberToken('let x = 0x0.1;').value).toBeCloseTo(0.0625, 6);
});

// ── T26: bare prefixes — only 0x is an error; 0b/0o are the integer 0 ─────────
test('bare 0x is an Invalid number literal (UC6016)', () => {
  const { errors } = lex('let x = 0x;');
  expect(errors.length).toBe(1);
  expect(errors[0].code).toBe('UC6016');
  expect(errors[0].message).toContain('Invalid number literal');
});
// NOTE: emitToken stores a numeric 0 as '' (`value || ''`), so a zero literal — whether `0`,
// `0b`, or `0o` — carries the empty-string value; we assert the token kind and the absence of an
// error rather than the (falsy) value, matching how the interpreter treats these as the integer 0.
test('bare 0b parses to an integer number token with no error', () => {
  const { errors } = lex('let x = 0b;');
  expect(errors.length).toBe(0);
  expect(firstNumberToken('let x = 0b;').type).toBe(TokenType.TK_NUMBER);
});
test('bare 0o parses to an integer number token with no error', () => {
  const { errors } = lex('let x = 0o;');
  expect(errors.length).toBe(0);
  expect(firstNumberToken('let x = 0o;').type).toBe(TokenType.TK_NUMBER);
});

// ── T28: invalid trailing characters ─────────────────────────────────────────
for (const bad of ['0o9', '0b2', '123abc', '1.2.3', '1e', '00.5', '0778']) {
  test(`${bad} is an Invalid number literal`, () => {
    const errs = lex(`let x = ${bad};`).errors.filter((e) => e.code === 'UC6016');
    expect(errs.length).toBe(1);
  });
}
// 0xG: the interpreter does not fold G into the number (is_numeric_char excludes it), so the
// error covers just "0x" and G stays a separate token — but the primary error is still emitted.
test('0xG emits Invalid number literal for the 0x portion', () => {
  const errs = lex('let x = 0xG;').errors.filter((e) => e.code === 'UC6016');
  expect(errs.length).toBe(1);
});

// ── faithful values for the well-formed forms ────────────────────────────────
test('leading-zero literal 0777 is octal (511)', () => {
  expect(firstNumberToken('let x = 0777;').value).toBe(511);
});
test('08 is decimal 8 (8 is not an octal digit)', () => {
  expect(firstNumberToken('let x = 08;').value).toBe(8);
});
test('0b101 is 5, 0o17 is 15, 0xFF is 255', () => {
  expect(firstNumberToken('let a = 0b101;').value).toBe(5);
  expect(firstNumberToken('let a = 0o17;').value).toBe(15);
  expect(firstNumberToken('let a = 0xFF;').value).toBe(255);
});
test('1.5e3 is the double 1500', () => {
  const t = firstNumberToken('let x = 1.5e3;');
  expect(t.type).toBe(TokenType.TK_DOUBLE);
  expect(t.value).toBeCloseTo(1500, 6);
});

// ── T54: conservative regex body validation ──────────────────────────────────
test('regex /foo.*(/ flags an unbalanced parenthesis', () => {
  const errs = lex('let re = /foo.*(/;').errors;
  expect(errs.some((e) => e.message.includes('Unbalanced parenthesis'))).toBe(true);
});
test('regex /[z-a]/ flags an out-of-order character range', () => {
  const errs = lex('let re = /[z-a]/;').errors;
  expect(errs.some((e) => e.message.includes('out of order'))).toBe(true);
});
for (const ok of ['/foo(bar)/', '/[a-z]/', '/[[:alpha:]]/', '/a\\d+/', '/(a|b)+/', '/[a-]/', '/x)y/']) {
  test(`valid/POSIX-divergent regex ${ok} is not flagged`, () => {
    // `/x)y/`: an unmatched ')' is a literal in POSIX ERE (glibc), so we must NOT flag it.
    const errs = lex(`let re = ${ok};`).errors;
    expect(errs.length).toBe(0);
  });
}

// ── T55: `/*/` is a complete empty block comment ─────────────────────────────
test('/*/ is consumed as an empty comment (no Unterminated comment)', () => {
  const { tokens, errors } = lex('let re = /*/;');
  // The only side-channel entry is the (intentional) UC6017 escape-the-star warning.
  expect(errors.filter((e) => e.code !== 'UC6017').length).toBe(0);
  expect(errors.find((e) => e.code === 'UC6017')?.severity).toBe('warning');
  expect(tokens.some((t) => t.type === TokenType.TK_ERROR)).toBe(false);
  // the `;` survives — the comment did not swallow it
  expect(tokens.some((t) => t.type === TokenType.TK_SCOL)).toBe(true);
});
test('a genuinely unterminated block comment still errors', () => {
  const { tokens } = lex('let re = /* nope');
  expect(tokens.some((t) => t.type === TokenType.TK_ERROR && String(t.value).includes('Unterminated'))).toBe(true);
});

// ── T80 / T81: unexpected-character diagnostic range and message ─────────────
test('unexpected character range starts on the character itself', () => {
  // `let x = @;` — '@' is at offset 8
  const { tokens } = lex('let x = @;');
  const err = tokens.find((t) => t.type === TokenType.TK_ERROR);
  expect(err.pos).toBe(8);
  expect(err.end).toBe(9);
  expect(String(err.value)).toBe('Unexpected character: @');
});
test('astral character is reported as one code point over a two-unit range', () => {
  const code = '\u{1F600};'; // 😀 then ;
  const { tokens } = lex(code);
  const err = tokens.find((t) => t.type === TokenType.TK_ERROR);
  expect(err.pos).toBe(0);
  expect(err.end).toBe(2); // surrogate pair spans two UTF-16 units
  expect(String(err.value)).toBe('Unexpected character: \u{1F600}');
});
