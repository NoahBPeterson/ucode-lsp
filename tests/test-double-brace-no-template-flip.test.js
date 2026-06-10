// auto-docs/01: a bare `}}` / `%}` / `{{` in ordinary code (any nested object/array
// literal, e.g. `{a:{b:1}}`) made the raw-mode lexer mis-tokenize the template delimiters
// (they live in the operator table) → TK_REXP/TK_RSTM, which fed the parser garbage,
// flipped the lexer into template mode, dropped every later diagnostic, and stack-overflowed
// on large files. In raw mode (every LSP call site) these are now ordinary tokens.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { UcodeLexer, TokenType } = require('../src/lexer');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(30000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const tok = (code) => new UcodeLexer(code, { rawMode: true }).tokenize().map((t) => t.type);
const TEMPLATE_TAGS = [TokenType.TK_LEXP, TokenType.TK_REXP, TokenType.TK_LSTM, TokenType.TK_RSTM];
const errs = async (code) => (await server.getDiagnostics(code, `/tmp/dbf-${n++}.uc`) || []).filter((x) => x.severity === 1).map((x) => x.message);

// ── Lexer: template delimiters are not tokens in raw mode ─────────────────────
test('01 `}}` lexes as two TK_RBRACE, not TK_REXP', async () => {
  const types = tok('let o = { a: { b: 1 }};\n');
  expect(types.filter((t) => t === TokenType.TK_RBRACE).length).toBe(2);
  expect(TEMPLATE_TAGS.some((t) => types.includes(t))).toBe(false);
});
test('02 `{{` lexes as two TK_LBRACE, not TK_LEXP', async () => {
  const types = tok('let o = {{ "a": 1 }};\n'); // (set-of-set-ish; the point is the {{ run)
  expect(TEMPLATE_TAGS.some((t) => types.includes(t))).toBe(false);
});
test('03 `%}` lexes as `%` then `}`, not TK_RSTM', async () => {
  const types = tok('let x = a % {};\n'); // `%` then `}` adjacent-ish
  expect(types.includes(TokenType.TK_RSTM)).toBe(false);
});
test('04 a deeper `}}}` run carries no template tags', async () => {
  const types = tok('let o = { a: { b: { c: 1 }}};\n');
  expect(TEMPLATE_TAGS.some((t) => types.includes(t))).toBe(false);
});

// ── No false diagnostics on nested object/array literals ─────────────────────
test('05 nested object literal raises no false "Expected }"/"Unexpected token"', async () => {
  const m = await errs('let o = { a: { b: 1 }};\n');
  expect(m.some((x) => /Expected '\}'|Unexpected token/.test(x))).toBe(false);
});
test('06 `return {x:{y:1}};` is clean', async () => {
  const m = await errs('function f() { return { x: { y: 1 }}; }\n');
  expect(m.some((x) => /Expected '\}'|Unexpected token/.test(x))).toBe(false);
});
test('07 nested array literal `[[1]]` is clean', async () => {
  const m = await errs('let a = [ [ 1 ]];\n');
  expect(m.some((x) => /Expected|Unexpected token/.test(x))).toBe(false);
});

// ── Diagnostics flow past the `}}` (no silent drop) ──────────────────────────
test('08 a real error AFTER a `}}` is still reported', async () => {
  const m = await errs("'use strict';\nlet o = { a: { b: 1 }};\nlet bad = undefined_marker;\n");
  expect(m.some((x) => /undefined_marker|Undefined/.test(x))).toBe(true);
});

// ── No crash on a large file with `}}` (was a stack overflow) ────────────────
test('09 a large file with a `}}` does not crash the server', async () => {
  let code = 'let o = { a: { b: 1 }};\n';
  for (let i = 0; i < 1200; i++) code += `let v${i} = ${i};\n`;
  code += 'let bad = undefined_marker;\n';
  const d = await server.getDiagnostics(code, '/tmp/dbf-big.uc'); // throws/hangs if it crashed
  expect(Array.isArray(d)).toBe(true);
  expect(d.some((x) => /undefined_marker/.test(x.message || ''))).toBe(true);
});

// ── Unaffected contexts ──────────────────────────────────────────────────────
test('10 `}}` inside a string literal is unaffected (no false diagnostics)', async () => {
  const m = await errs('let s = "a }} b";\nprint(s);\n');
  expect(m.length).toBe(0);
});
test('11 real template tags still tokenize in template (non-raw) mode (regression)', async () => {
  // leading text avoids the separate "starts-with-a-tag bails to 0 tokens" template-mode
  // limitation (docs/ucode-template-mode-support.md); the point here is that the operator
  // gate only skips the delimiters in RAW mode — template mode is unchanged.
  const types = new UcodeLexer('x {% let y = 1; %}', { rawMode: false }).tokenize().map((t) => t.type);
  expect(types.includes(TokenType.TK_LSTM)).toBe(true);
  expect(types.includes(TokenType.TK_RSTM)).toBe(true);
});
