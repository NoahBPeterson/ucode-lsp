// Bucket / group-by idiom: `m[k] ??= []; push(m[k], v)` (and `||= []`).
// A computed read dominated by a same-block nullish-assign of an array literal,
// on a uniformly-array-valued local map, types as `array` — so push() no longer
// false-flags "Argument 1 of push() is unknown".
// Soundness: the genuinely-unsafe cases (non-array write, no ??=, conditional
// ??=, base is a param, base reassigned between) must STILL flag.
// See docs/nullish-assign-bucket-narrowing.md.
const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer.ts');

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  const parseResult = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true });
  return analyzer.analyze(parseResult.ast);
}

const pushWarnings = (code) =>
  analyze(code).diagnostics.filter(d => /Argument 1 of push\(\)/.test(d.message));

test('bucket idiom with a dynamic key does not flag push', () => {
  const code = `function sort_completion(data) {
    let categories = {};
    for (let entry in data) {
        let cat = entry.category ?? " ";
        categories[cat] ??= [];
        push(categories[cat], entry);
    }
    return categories;
}`;
  expect(pushWarnings(code).length).toBe(0);
});

test('bucket idiom with a static key does not flag push', () => {
  const code = `let categories = {};
categories["x"] ??= [];
push(categories["x"], 1);`;
  expect(pushWarnings(code).length).toBe(0);
});

test('bucket idiom with ||= does not flag push', () => {
  const code = `let m = {};
m["a"] ||= [];
push(m["a"], 1);`;
  expect(pushWarnings(code).length).toBe(0);
});

test('SOUND: a non-array write to the map still flags push (not uniformly array-valued)', () => {
  const code = `let m = {};
m["a"] = "string";
m["b"] ??= [];
push(m["b"], 1);`;
  expect(pushWarnings(code).length).toBe(1);
});

test('SOUND: no ??= before push still flags', () => {
  const code = `let m = {};
push(m["b"], 1);`;
  expect(pushWarnings(code).length).toBe(1);
});

test('SOUND: a conditional (non-dominating) ??= still flags', () => {
  const code = `function f(c) {
  let m = {};
  if (c) m["b"] ??= [];
  push(m["b"], 1);
}`;
  expect(pushWarnings(code).length).toBe(1);
});

test('SOUND: base is a parameter (unknown value shape) still flags', () => {
  const code = `function f(m) {
  m["b"] ??= [];
  push(m["b"], 1);
}`;
  expect(pushWarnings(code).length).toBe(1);
});

test('SOUND: base reassigned between ??= and push still flags', () => {
  const code = `function f(other) {
  let m = {};
  m["b"] ??= [];
  m = other;
  push(m["b"], 1);
}`;
  expect(pushWarnings(code).length).toBe(1);
});
