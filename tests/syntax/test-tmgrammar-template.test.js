// TextMate grammar: the `.ut` ucode-template wrapper grammar (source.ucode-template).
// HTML text stays plain; `{% %}` / `{{ }}` blocks embed the full source.ucode grammar
// (real delegation — a regex literal inside a block gets string.regexp.ucode); the
// `{# #}` comment form spans lines and swallows tag-lookalikes; the `[-+]` whitespace
// trim modifiers are part of the tag punctuation (verified against ucode's lexer.c
// template scanner); and a `%}` inside an embedded ucode string does NOT close the
// block, because the inner string scope blocks the outer end pattern.
//
// Tokenizes with the real grammars via vscode-textmate + vscode-oniguruma (devDeps).
import { test, expect, beforeAll } from 'bun:test';
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const TEMPLATE_GRAMMAR = path.resolve(__dirname, '../../syntaxes/ucode-template.tmLanguage.json');
const UCODE_GRAMMAR = path.resolve(__dirname, '../../syntaxes/ucode.tmLanguage.json');
let grammar;

beforeAll(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
  const onigLib = oniguruma.loadWASM(wasm).then(() => ({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }));
  const registry = new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      // text.html.basic isn't shipped by us — the registry returns null and the
      // include degrades to plain text, which is exactly the standalone behavior.
      if (scopeName === 'source.ucode-template') return vsctm.parseRawGrammar(fs.readFileSync(TEMPLATE_GRAMMAR, 'utf8'), TEMPLATE_GRAMMAR);
      if (scopeName === 'source.ucode') return vsctm.parseRawGrammar(fs.readFileSync(UCODE_GRAMMAR, 'utf8'), UCODE_GRAMMAR);
      return null;
    },
  });
  grammar = await registry.loadGrammar('source.ucode-template');
});

// Per-char scope map: 'E' embedded ucode block content, 'P' tag punctuation,
// 'C' template comment, 'R' string.regexp inside embedded code, '.' plain text.
function scopeLines(src) {
  let rule = vsctm.INITIAL;
  return src.split('\n').map((line) => {
    const res = grammar.tokenizeLine(line, rule);
    rule = res.ruleStack;
    const marks = new Array(line.length).fill('.');
    for (const t of res.tokens) {
      const isComment = t.scopes.some((s) => s.startsWith('comment.block.ucode-template'));
      const isPunct = t.scopes.some((s) => s.startsWith('punctuation.section.embedded') || s.startsWith('punctuation.definition.comment'));
      const isRegex = t.scopes.some((s) => s.startsWith('string.regexp'));
      const isEmbedded = t.scopes.some((s) => s === 'meta.embedded.block.ucode');
      for (let i = t.startIndex; i < Math.min(t.endIndex, line.length); i++) {
        marks[i] = isPunct ? 'P' : isComment ? 'C' : isRegex ? 'R' : isEmbedded ? 'E' : '.';
      }
    }
    return marks.join('');
  });
}

test('registry serves the template grammar with the ucode grammar embedded', () => {
  expect(grammar).toBeTruthy();
});

test('HTML stays plain around a statement block', () => {
  const [l] = scopeLines('<div>{% let x = 1; %}</div>');
  expect(l).toBe('.....PPEEEEEEEEEEEEPP......');
});

test('a multi-line {% %} block stays embedded until the closer', () => {
  const [l1, l2, l3, l4] = scopeLines('{%\nlet a = 1;\n%}\n<p>after</p>');
  expect(l1).toBe('PP');
  expect(l2).toBe('EEEEEEEEEE');
  expect(l3).toBe('PP');
  expect(l4).toBe('............');            // scope closed — HTML unaffected
});

test('{{ expr }} embeds as ucode', () => {
  const [l] = scopeLines('<b>{{ name }}</b>');
  expect(l).toBe('...PPEEEEEEPP....');
});

test('trim modifiers {%- {%+ -%} {{- -}} are part of the tags', () => {
  const [stmt] = scopeLines('{%- let y = 2; -%}');
  expect(stmt.startsWith('PPP')).toBe(true);
  expect(stmt.endsWith('PPP')).toBe(true);
  const [plus] = scopeLines('{%+ x; %}');
  expect(plus.startsWith('PPP')).toBe(true);
  const [expr] = scopeLines('{{- name -}}');
  expect(expr.startsWith('PPP')).toBe(true);
  expect(expr.endsWith('PPP')).toBe(true);
});

test('a {# #} comment spans lines and swallows a {% inside it', () => {
  const [l1, l2, l3] = scopeLines('{# start\n{% not code %}\ndone #} <i>x</i>');
  expect(l1).toBe('PPCCCCCC');
  expect(l2).toBe('CCCCCCCCCCCCCC');          // the tag-lookalike stays comment
  expect(l3.startsWith('CCCCCPP')).toBe(true);
  expect(l3.endsWith('........')).toBe(true); // HTML after the closer is plain
});

test('a regex literal inside a block gets string.regexp (real ucode delegation)', () => {
  const [l] = scopeLines('{% let r = /a[0-9]+z/; %}');
  expect(l).toContain('R');
  expect(l.indexOf('R')).toBe(11);            // the regex body, not the tag
});

test('a %} inside an embedded ucode string does not close the block', () => {
  const [l] = scopeLines('{% let s = "100%}"; %} <u>t</u>');
  // The string's %} at cols 15-16 must still be embedded content; the REAL
  // closer is at cols 20-21 and everything after it is plain HTML.
  expect(l[15]).toBe('E');
  expect(l[16]).toBe('E');
  expect(l.slice(20, 22)).toBe('PP');
  expect(l.endsWith('.........')).toBe(true);
});
