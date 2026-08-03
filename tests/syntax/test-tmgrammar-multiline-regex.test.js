// TextMate grammar: multi-line regex literals must highlight like single-line ones.
// ucode regex literals may span raw newlines (parser support 0.7.74; verified against the
// interpreter), but the grammar's regex/end and char-class/end patterns carried a
// `|((?<!\\)$)` EOL bailout (0.6.173 anti-desync era, when multi-line regexes were treated
// as errors) that killed the scope at end of line. Also pins the leading-`]`-is-literal
// class rule (parser parity: 0.7.75) which the grammar lacked.
//
// Tokenizes with the real grammar via vscode-textmate + vscode-oniguruma (devDeps).
import { test, expect, beforeAll } from 'bun:test';
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR = path.resolve(__dirname, '../../syntaxes/ucode.tmLanguage.json');
let grammar;

beforeAll(async () => {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
  const onigLib = oniguruma.loadWASM(wasm).then(() => ({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s),
  }));
  const registry = new vsctm.Registry({
    onigLib,
    loadGrammar: async () => vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR),
  });
  grammar = await registry.loadGrammar('source.ucode');
});

// Per-char scope map: 'R' regex, 'c' char-class (inside a regex), '.' neither.
function scopeLines(src) {
  let rule = vsctm.INITIAL;
  return src.split('\n').map((line) => {
    const res = grammar.tokenizeLine(line, rule);
    rule = res.ruleStack;
    const marks = new Array(line.length).fill('.');
    for (const t of res.tokens) {
      const cl = t.scopes.some((s) => s.startsWith('constant.other.character-class'));
      const re = t.scopes.some((s) => s.startsWith('string.regexp'));
      for (let i = t.startIndex; i < Math.min(t.endIndex, line.length); i++) {
        marks[i] = cl ? 'c' : re ? 'R' : '.';
      }
    }
    return marks.join('');
  });
}

// NOTE (contract update, grammar fix session 2026-08-02): the whitespace between
// the trigger char and the `/` used to be scoped string.regexp (the rule's `name`
// covered the begin match's `\s*`). The rule now uses contentName + delimiter
// captures, so that space is unscoped — every pin below starts one column later
// than its pre-fix counterpart.

test('multi-line regex body stays regex-scoped across the newline', () => {
  const [l1, l2, l3] = scopeLines('let multiline = /foo\nbar/;\nlet after1 = 1;');
  expect(l1).toBe('................RRRR');
  expect(l2).toBe('RRRR.');            // bar/ is regex; the ; is not
  expect(l3).toBe('...............');  // scope closed — following code unaffected
});

test('flags after a multi-line body are part of the regex', () => {
  const [, l2, l3] = scopeLines('let mf = /a\nb/g;\nlet after2 = 2;');
  expect(l2).toBe('RRR.');             // b/g
  expect(l3).toBe('...............');
});

test('a character class spanning a newline stays class-scoped', () => {
  const [l1, l2, l3] = scopeLines('let nc = /[a\nb]/;\nlet after3 = 3;');
  expect(l1.endsWith('Rcc')).toBe(true);
  expect(l2).toBe('ccR.');             // b] closes the class, / closes the regex
  expect(l3).toBe('...............');
});

test('single-line regex and division are unchanged', () => {
  expect(scopeLines('let s = /x+/i; let after = 4;')[0]).toBe('........RRRRR................');
  expect(scopeLines('let d = a / b; let e = c / 2;')[0]).toBe('.............................');
});

test('escaped slash and escaped brackets do not close early', () => {
  const esc = scopeLines('let m1 = match(p, /([^\\/]+)$/);')[0];
  expect(esc).toBe('..................RRcccccRRRR..');
  const br = scopeLines('let m2 = match(d, /\\[([^\\]]+)\\]/);')[0];
  expect(br).toBe('..................RRRRcccccRRRRR..');
});

test('leading ] in a class is literal; a / inside a class does not end the regex', () => {
  expect(scopeLines('let r = /[]a]/; let z = 5;')[0]).toBe('........RccccR............');
  expect(scopeLines('let q = /[/]/; let w = 6;')[0]).toBe('........RcccR............');
});

// The begin lookbehind now also recognizes `return`, `case`, `&&`, `||` as
// regex positions. An unrecognized regex renders as PLAIN code — and plain
// tokens are exactly where VS Code's bracket-pair colorizer paints unmatched
// `)`/`]` in "unexpected bracket" red, which is how valid return-position
// regexes acquired red characters in the editor.
test('return-position regex is recognized and fully scoped', () => {
  const m = scopeLines('function f(s) { return /a[0-9]+z/; }')[0];
  expect(m).toBe('.......................RRcccccRRR...');
});

test('&& and || operand regexes are recognized', () => {
  expect(scopeLines('let ok = x && /yes/;')[0]).toBe('..............RRRRR.');
  expect(scopeLines('let ok2 = x || /no/;')[0]).toBe('...............RRRR.');
});

test('division after return / operands stays plain', () => {
  expect(scopeLines('return a / b;')[0]).toBe('.............');
  expect(scopeLines('let t = s / 2;')[0]).toBe('..............');
});

test('the whitespace before a regex literal is NOT regex-scoped', () => {
  // "let s = /x/" — the space at col 7 must stay unscoped; the regex starts at 8.
  const m = scopeLines('let s = /x/;')[0];
  expect(m[7]).toBe('.');
  expect(m[8]).toBe('R');
});

test('comments after regex-bearing lines stay comments', () => {
  const lines = scopeLines(
    'let m2 = match(d, /\\[([^\\]]+)\\]/);  // text inside [brackets]\n' +
    'print(1);  // leading-literal-] note');
  expect(lines[0].slice(36)).toBe('.'.repeat(lines[0].length - 36)); // comment region unscoped by regex
  expect(lines[1]).toBe('.'.repeat(lines[1].length));
});
