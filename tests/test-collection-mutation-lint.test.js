const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');

// UC4005: mutating the collection a loop iterates. ucode iterates arrays by a
// live index, so growing (push/unshift) loops forever and shrinking
// (pop/shift/splice) silently skips elements — UNLESS the mutation is the loop's
// own progress (the `while (length(C) > 0) shift(C)` consume idiom, which has no
// independent index) or the loop exits right after the mutation.

function count(code) {
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else c++; } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < ls.length; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1
  };
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true })
    .analyze(ast).diagnostics.filter(d => d.code === 'UC4005').length;
}

test('for-in: mutating the iterated collection is flagged', () => {
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ pop(b); } }`)).toBe(1);
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ splice(b,0,1); } }`)).toBe(1);
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ push(b, 9); } }`)).toBe(1); // growth → infinite
});

test('index-against-length loops with mutation are flagged', () => {
  expect(count(`function f(){ let c=[1,2,3]; for (let i=0;i<length(c);i++){ pop(c); } }`)).toBe(1);
  expect(count(`function f(){ let c=[1,2,3]; let i=0; while (i<length(c)){ pop(c); i++; } }`)).toBe(1);
  expect(count(`function f(){ let c=[1,2,3]; for (let i=0;length(c)>i;i++){ shift(c); } }`)).toBe(1);
});

test('the consume idiom is NOT flagged (mutation is the only progress)', () => {
  expect(count(`function f(){ let c=[1,2,3]; while (length(c) > 0){ let a = shift(c); print(a); } }`)).toBe(0);
  expect(count(`function f(){ while (length(ARGV) > 0){ let a = shift(ARGV); } }`)).toBe(0);
  expect(count(`function f(){ let c=[1,2,3]; while (length(c)){ pop(c); } }`)).toBe(0);
});

test('mutate-then-exit is suppressed; mutate-then-continue is NOT', () => {
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ if (x==2){ splice(b,0,1); break; } } }`)).toBe(0);
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ splice(b,0,1); return; } }`)).toBe(0);
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ pop(b); exit(1); } }`)).toBe(0);
  // continue stays in the loop → the next (corrupted) iteration still runs → flag
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ splice(b,0,1); continue; } }`)).toBe(1);
});

test('mutating a different array, or an element, is not flagged', () => {
  expect(count(`function f(){ let b=[1,2,3]; let c=[9]; for (let x in b){ pop(c); } }`)).toBe(0);
  expect(count(`function f(){ let b=[[1]]; for (let x in b){ push(x, 9); } }`)).toBe(0); // x is an element, not b
  expect(count(`function f(){ let b=[1,2,3]; for (let x in b){ print(x); } }`)).toBe(0);
});
