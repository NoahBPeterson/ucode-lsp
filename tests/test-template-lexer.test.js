// Phase 1 of real template-mode bring-up (C9b): the lexer must tokenize ucode
// template files (`{% %}` / `{{ }}` / `{# #}`) instead of bailing to 0 tokens.
//
// Mode is invocation-determined in ucode (utpl/-T = template, ucode/-R = raw);
// here we exercise the lexer directly in template mode (rawMode: false).
// Bugs fixed: (1) a file starting with a tag emitted an empty leading TK_TEXT,
// which returned null and stopped tokenize() at 0 tokens; (2) a file ending on a
// tag dropped its TK_EOF; (3) whitespace-trim markers {%- {%+ -%} -}} were not
// handled; (4) a comment block recursively consumed the next two chars.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { TokenType } from '../src/lexer/tokenTypes.ts';

const lex = (src) => new UcodeLexer(src, { rawMode: false }).tokenize();
const types = (src) => lex(src).map((t) => t.type);
const has = (src, tt) => types(src).includes(tt);
const last = (src) => { const t = lex(src); return t[t.length - 1].type; };

describe('template-mode lexer (Phase 1)', () => {
  test('a file starting with a tag tokenizes (was 0 tokens)', () => {
    const t = lex('{% let a = 1; %}rest');
    expect(t.length).toBeGreaterThan(1);
    expect(t[0].type).toBe(TokenType.TK_LSTM);
  });

  test('text before a tag yields a TK_TEXT chunk then the tag', () => {
    const t = types('table inet fw4\n{% if (x): %}');
    expect(t[0]).toBe(TokenType.TK_TEXT);
    expect(t).toContain(TokenType.TK_LSTM);
    expect(t).toContain(TokenType.TK_IF);
    expect(t).toContain(TokenType.TK_COLON); // alt-syntax `if (...):`
  });

  test('expression tag lexes {{ ... }}', () => {
    expect(has('{{ fw4.set(d) }}', TokenType.TK_LEXP)).toBe(true);
    expect(has('{{ fw4.set(d) }}', TokenType.TK_REXP)).toBe(true);
  });

  test('a file ending on a tag still emits TK_EOF', () => {
    expect(last('text{% let a = 1; %}')).toBe(TokenType.TK_EOF);
  });

  test('whitespace-trim open/close markers do not leak operator tokens', () => {
    // `{%-` / `-%}` must NOT produce TK_SUB; `{%+` is the no-strip variant.
    for (const src of ['{%- let a = 1; -%}', '{%+ let a = 1; %}']) {
      const t = types(src);
      expect(t[0]).toBe(TokenType.TK_LSTM);
      expect(t).toContain(TokenType.TK_RSTM);
      expect(t).not.toContain(TokenType.TK_SUB);
      expect(t).not.toContain(TokenType.TK_ADD);
    }
  });

  test('expression trim `-}}` closes the expression cleanly', () => {
    const t = types('x{{- a -}}y');
    expect(t).toEqual([
      TokenType.TK_TEXT, TokenType.TK_LEXP, TokenType.TK_LABEL,
      TokenType.TK_REXP, TokenType.TK_TEXT, TokenType.TK_EOF,
    ]);
  });

  test('a comment block is skipped without consuming the following tag', () => {
    const t = types('{# a comment #}{% let a = 1; %}');
    expect(t[0]).toBe(TokenType.TK_LSTM); // not a mangled token from phantom `{#`
    expect(t).toContain(TokenType.TK_LOCAL);
    expect(last('{# a comment #}{% let a = 1; %}')).toBe(TokenType.TK_EOF);
  });

  test('raw mode is unaffected: `{%`/`}}` are ordinary operators, no TK_TEXT', () => {
    const t = new UcodeLexer('let o = { a: 1 }; let p = o.a % 2;', { rawMode: true }).tokenize();
    expect(t.map((x) => x.type)).not.toContain(TokenType.TK_TEXT);
    expect(t.map((x) => x.type)).not.toContain(TokenType.TK_LSTM);
  });
});
