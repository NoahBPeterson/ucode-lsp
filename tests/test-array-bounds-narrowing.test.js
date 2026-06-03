const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');

// A literal index into an array<string> is normally `string | null` (ucode
// returns null past the end). An enclosing `length(arr) <op> N` guard that proves
// the index is in bounds drops the null — so e.g. `if (length(parts)==10) uc(parts[3])`
// no longer warns "possibly null". Out-of-bounds indices and unguarded access
// stay nullable (sound).

function nullWarnCount(body) {
  // `parts` is a pure array<string> via split of a string literal.
  const code = `function f() {\n  let parts = split("a,b", ",");\n${body}\n}`;
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else c++; } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < ls.length; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1
  };
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const ds = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast).diagnostics;
  return ds.filter(d => /possibly .*null|nullable|incompatible-function-argument/i.test(d.message + ' ' + (d.code || ''))).length;
}

test('length == N guard: literal index < N is in bounds (no null)', () => {
  expect(nullWarnCount(`  if (length(parts) == 10) { let r = uc(parts[3]); }`)).toBe(0);
  expect(nullWarnCount(`  if (length(parts) == 10) { let r = uc(parts[9]); }`)).toBe(0);
});

test('length == N guard: index >= N stays out of bounds (still nullable)', () => {
  expect(nullWarnCount(`  if (length(parts) == 10) { let r = uc(parts[10]); }`)).toBe(1);
});

test('no guard: literal index stays nullable', () => {
  expect(nullWarnCount(`  let r = uc(parts[0]);`)).toBe(1);
});

test('length >= N and length > N guards prove a lower bound', () => {
  expect(nullWarnCount(`  if (length(parts) >= 4) { let r = uc(parts[3]); }`)).toBe(0);
  expect(nullWarnCount(`  if (length(parts) >= 4) { let r = uc(parts[4]); }`)).toBe(1); // 4 not < 4
  expect(nullWarnCount(`  if (length(parts) > 3) { let r = uc(parts[3]); }`)).toBe(0);  // >3 → >=4 → idx 3 ok
  expect(nullWarnCount(`  if (length(parts) > 3) { let r = uc(parts[4]); }`)).toBe(1);  // idx 4 not proven
});

test('reversed operands (N == length(arr)) and && chains', () => {
  expect(nullWarnCount(`  if (10 == length(parts)) { let r = uc(parts[3]); }`)).toBe(0);
  expect(nullWarnCount(`  if (parts && length(parts) == 10) { let r = uc(parts[3]); }`)).toBe(0);
});

test('length < N / != N give no lower bound (stay nullable)', () => {
  expect(nullWarnCount(`  if (length(parts) < 10) { let r = uc(parts[3]); }`)).toBe(1);
  expect(nullWarnCount(`  if (length(parts) != 10) { let r = uc(parts[3]); }`)).toBe(1);
});
