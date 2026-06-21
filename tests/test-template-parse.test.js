// Phases 2-3 of template-mode bring-up (C9b): detection + parsing.
//
// Phase 2: the framing tokens are bridged to statement separators so the ordinary
// parser consumes a template (text -> dropped, {{e}} -> expr statement, {% s %} -> s,
// alt-colon `if(x): … elif … else … endif` / `for(): … endfor` / `while(): … endwhile`).
// Phase 3: detectTemplateMode replicates ucode's raw-vs-template decision per file.
//
// The user-facing win this locks in: a template produces ZERO parse-error garbage
// (the UC6004 storm). Remaining UC1001 on render-scope free vars is phase 4.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../src/lexer/index.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';

function parseTemplate(src) {
  const isT = detectTemplateMode(src);
  const lx = new UcodeLexer(src, { rawMode: !isT });
  const toks = isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize();
  return { isTemplate: isT, result: new UcodeParser(toks, src).parse() };
}
const parseErrors = (src) => parseTemplate(src).result.errors;

describe('detectTemplateMode', () => {
  test('leading template tag → template', () => {
    expect(detectTemplateMode('{% let a = 1; %}')).toBe(true);
    expect(detectTemplateMode('text {{ a }} more')).toBe(true);
    expect(detectTemplateMode('{# c #}')).toBe(true);
  });
  test('plain raw script → not template', () => {
    expect(detectTemplateMode("let o = { a: 1 }; return o.a % 2;")).toBe(false);
    expect(detectTemplateMode("import { x } from 'fs';\nx();")).toBe(false);
  });
  test('a tag-looking sequence inside a STRING is not a template (regression)', () => {
    expect(detectTemplateMode('let t = "Hello {{name}}"; proto(o);')).toBe(false);
    expect(detectTemplateMode("let s = 'a {% b %} c';")).toBe(false);
    expect(detectTemplateMode('let s = `x {# y #} z`;')).toBe(false);
  });
  test('a tag-looking sequence inside a COMMENT is not a template (regression)', () => {
    expect(detectTemplateMode('// render {{x}}\nlet a = 1;')).toBe(false);
    expect(detectTemplateMode('/* {% if %} */ let a = 1;')).toBe(false);
  });
  test('shebang honors ucode CLI semantics', () => {
    expect(detectTemplateMode('#!/usr/bin/utpl\n{% x %}')).toBe(true);
    expect(detectTemplateMode('#!/usr/bin/ucode -T\nfoo')).toBe(true);
    expect(detectTemplateMode('#!/usr/bin/ucode -R\n{% x %}')).toBe(false); // -R forces raw
  });
});

describe('template parsing produces no parse-error storm', () => {
  test('interpolations and statements', () => {
    expect(parseErrors('table inet fw4\n{% let a = 1; %}\nval {{ a }} end').length).toBe(0);
  });
  test('adjacent interpolations do not collapse into one expression', () => {
    // `{{a}}{{b}}` must become two expression statements, not the invalid `a b`.
    expect(parseErrors('x{{ a }}{{ b }}y').length).toBe(0);
  });
  test('alt-colon if / elif / else / endif across tags', () => {
    const src = '{% if (x): %}A{% elif (y): %}B{% else %}C{% endif %}';
    expect(parseErrors(src).length).toBe(0);
  });
  test('alt-colon for / endfor and while / endwhile', () => {
    expect(parseErrors('{% for (k in items): %}{{ k }}{% endfor %}').length).toBe(0);
    expect(parseErrors('{% while (cond): %}x{% endwhile %}').length).toBe(0);
  });
  test('whitespace-trim markers parse cleanly', () => {
    expect(parseErrors('{%- if (a): -%}T{%- endif -%}').length).toBe(0);
  });
  test('valid close trims (-%} / -}}) and plain closes are clean', () => {
    expect(parseErrors('{%- let a = 1; -%}{{- a -}}').length).toBe(0);
    expect(parseErrors('{% let a = 1; %}{{ a }}').length).toBe(0);
  });
  test('INVALID close modifiers +%} / +}} are rejected (ucode rejects them too)', () => {
    // `+` is an OPEN-only modifier; on close it is a syntax error in every ucode
    // release. Accepting what ucode rejects would be a false negative, so the
    // lexer must NOT tolerate it (regression for the bogus "{%+ defeats strict").
    expect(parseErrors("{%+ 'use strict'; +%}x").length).toBeGreaterThan(0);
    expect(parseErrors('{{ a +}}').length).toBeGreaterThan(0);
  });
  test('the OPEN modifier {%+ / {{+ is still valid (only the close is rejected)', () => {
    expect(parseErrors("{%+ let a = 1; %}{{+ a }}").length).toBe(0);
  });
});

describe('nested template blocks are rejected (ucode: "Template blocks may not be nested")', () => {
  const nestErr = (src) => parseTemplate(src).result.errors.map((e) => e.message);
  const hasNesting = (src) => nestErr(src).some((m) => /Template blocks may not be nested/.test(m));

  test('a {% block inside a {% block', () => expect(hasNesting('{% {% x %} %}')).toBe(true));
  test('a {{ block inside a {{ block', () => expect(hasNesting('{{ {{ x }} }}')).toBe(true));
  test('a {{ expr inside a {% statement', () => expect(hasNesting('{% let a = {{ b }}; %}')).toBe(true));
  test('a {% inside a {% across alt-colon control flow', () => expect(hasNesting('{% if (x): {% y %} endif %}')).toBe(true));
  test('adjacent {{ reads as a nested tag, not a nested object', () => expect(hasNesting('{% x = {{ c: 3 }}; %}')).toBe(true));

  // The ucode tokenizer is greedy, so ONLY adjacent `{{` / `{%` nest. These valid
  // forms must stay clean (no false positives on real object literals).
  test('a single-brace object literal is clean', () => expect(parseErrors('{% x = { a: 1 }; %}').length).toBe(0));
  test('a space-separated nested object `{ { } }` is clean', () => expect(parseErrors('{% x = { b: { c: 2 } }; %}').length).toBe(0));
  test('raw-mode code with adjacent braces is unaffected', () => expect(parseErrors('let o = { p: { q: 1 } };').length).toBe(0));
});

describe('unterminated template blocks (ucode: "Unterminated template block")', () => {
  const msgs = (src) => parseTemplate(src).result.errors.map((e) => e.message);
  const unterminated = (src) => msgs(src).some((m) => /Unterminated template block/.test(m));

  // ucode allows a STATEMENT block to run to EOF, but an EXPRESSION or COMMENT block
  // reaching EOF without its close is an error (verified vs the oracle, all versions).
  test('{{ expression with no }} at EOF → error', () => expect(unterminated('{{ 1 + 2')).toBe(true));
  test('text then {{ with no }} at EOF → error', () => expect(unterminated('hello {{ 1')).toBe(true));
  test('{# comment with no #} at EOF → error', () => expect(unterminated('{# unterminated')).toBe(true));

  test('{% statement with no %} at EOF → ALLOWED (clean), matching ucode', () =>
    expect(parseErrors('{% let x = 1; print(x)').length).toBe(0));
  test('text then {% with no %} at EOF → ALLOWED (clean)', () =>
    expect(parseErrors('hello {% print(1)').length).toBe(0));

  test('properly closed blocks are clean', () => {
    expect(parseErrors('{% let a = 1; %}{{ a }}').length).toBe(0);
    expect(parseErrors('{# c #}{% x = 1; %}').length).toBe(0);
  });
  test('the produced AST actually contains the in-tag code', () => {
    const { result } = parseTemplate('{% let answer = 42; %}');
    const kinds = (result.ast.body || []).map((n) => n.type);
    expect(kinds).toContain('VariableDeclaration');
  });
});

describe('raw mode is unchanged', () => {
  test('a raw script with `%` and `}}` is not treated as a template', () => {
    const src = 'let o = { a: { b: 1 } }; let r = o.a.b % 2;';
    expect(detectTemplateMode(src)).toBe(false);
    expect(parseErrors(src).length).toBe(0);
  });
});
