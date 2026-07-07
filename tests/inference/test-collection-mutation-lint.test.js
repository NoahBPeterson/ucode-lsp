const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');

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

// finding #59: a bare-identifier alias of the iteratee touches the same array object.
test('aliased iteratee: mutating the source array is flagged', () => {
  expect(count(`function f(){ let a=[1,2,3]; let c=a; for (let x in c){ push(a, x); } }`)).toBe(1);
  expect(count(`function f(){ let a=[1,2,3]; let c=a; for (let x in c){ pop(a); } }`)).toBe(1);
  // reassigning the iteratee before the loop breaks the alias → NOT flagged
  expect(count(`function f(){ let a=[1,2,3]; let c=a; c=[4,5,6]; for (let x in c){ push(a, x); } }`)).toBe(0);
  // reassigning the source before the loop breaks the alias → NOT flagged
  expect(count(`function f(){ let a=[1,2,3]; let c=a; a=[4,5,6]; for (let x in c){ push(a, x); } }`)).toBe(0);
});

// severity: an UNCONDITIONAL growth in a loop with NO exit is a provable infinite loop.
function severities(code) {
  const doc = {
    getText: () => code,
    positionAt: (o) => ({ line: 0, character: o }),
    offsetAt: (p) => p.character,
    uri: 'file:///t.uc', languageId: 'ucode', version: 1
  };
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true })
    .analyze(ast).diagnostics.filter(d => d.code === 'UC4005').map(d => d.severity); // 1=Error, 2=Warning
}

test('unconditional growth with no exit is an ERROR (provable infinite loop)', () => {
  expect(severities(`function f(){ let b=[1,2,3]; for (let it in b){ push(b, 99); } }`)).toEqual([1]);
  expect(severities(`function f(){ let b=[1,2,3]; for (let it in b) push(b, 99); }`)).toEqual([1]);
  expect(severities(`function f(){ let b=[1,2,3]; for (let i=0;i<length(b);i++){ unshift(b, 0); } }`)).toEqual([1]);
});

test('growth is only a WARNING when an exit is possible or it is conditional', () => {
  expect(severities(`function f(){ let b=[1,2,3]; for (let it in b){ push(b,99); if (it>9) break; } }`)).toEqual([2]);
  expect(severities(`function f(){ let b=[1,2,3]; for (let it in b){ push(b,99); if (it>9) return; } }`)).toEqual([2]);
  expect(severities(`function f(){ let b=[1,2,3]; for (let it in b){ if (it) push(b,99); } }`)).toEqual([2]);
});

test('shrink is always a WARNING (skips, but terminates)', () => {
  expect(severities(`function f(){ let b=[1,2,3]; for (let it in b){ pop(b); } }`)).toEqual([2]);
});

test('assert(<falsy literal>) counts as a loop exit (suppresses)', () => {
  expect(count(`function f(){ let b=[1,2,3]; for (let it in b){ splice(b,0,1); assert(false); } }`)).toBe(0);
  expect(count(`function f(){ let b=[1,2,3]; for (let it in b){ push(b,99); assert(0); } }`)).toBe(0);
  // a TRUTHY assert does not exit → still flagged
  expect(count(`function f(){ let b=[1,2,3]; for (let it in b){ splice(b,0,1); assert(true); } }`)).toBe(1);
});
