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
