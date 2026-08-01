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

test('multi-line regex body stays regex-scoped across the newline', () => {
  const [l1, l2, l3] = scopeLines('let multiline = /foo\nbar/;\nlet after1 = 1;');
  expect(l1).toBe('...............RRRRR');
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
  expect(scopeLines('let s = /x+/i; let after = 4;')[0]).toBe('.......RRRRRR................');
  expect(scopeLines('let d = a / b; let e = c / 2;')[0]).toBe('.............................');
});

test('escaped slash and escaped brackets do not close early', () => {
  const esc = scopeLines('let m1 = match(p, /([^\\/]+)$/);')[0];
  expect(esc).toBe('.................RRRcccccRRRR..');
  const br = scopeLines('let m2 = match(d, /\\[([^\\]]+)\\]/);')[0];
  expect(br).toBe('.................RRRRRcccccRRRRR..');
});

test('leading ] in a class is literal; a / inside a class does not end the regex', () => {
  expect(scopeLines('let r = /[]a]/; let z = 5;')[0]).toBe('.......RRccccR............');
  expect(scopeLines('let q = /[/]/; let w = 6;')[0]).toBe('.......RRcccR............');
});
