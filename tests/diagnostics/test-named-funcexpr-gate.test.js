// docs/named-funcexpr-let-const-crash.md - the version-gated crash diagnostic.
//
// On every OpenWrt RELEASE pin (22.03-25.12), a NAMED function expression anywhere
// inside a `let`/`const` declarator's initializer corrupts that declaration: the name
// is declared in the enclosing scope mid-initialization, shifting the local slots, so
// any later use of the variable fails to compile ("Can't access lexical declaration").
// Upstream e2493b5 fixed it; OpenWrt main's pin b885dd0 (2026-07-09) contains the fix.
//
// Oracle matrix (old binary vs master 81205a2, verified 2026-08-01):
//   let f = function g(n){...}; f(1)                 old: CRASH   new: ok
//   const f = function g(){}; f()                    old: CRASH   new: ok
//   let o = { m: function g(){} }; o.m()             old: CRASH   new: ok   (nested in init)
//   let r = sort([3,1], function cmp(a,b){...})      old: CRASH   new: ok   (call arg in init)
//   let f = function f(n){...}                       old: CRASH   new: ok   (same name)
//   let f = function(n){...}          (anonymous)    old: ok*     new: ok*  (*self-rec via f is
//                                                    a SEPARATE all-versions crash, other ticket)
//   !function g(){}();                (statement)    old: ok      new: ok
//   sort([1], function cmp(){})       (bare stmt)    old: ok      new: ok
//   let f; f = function g(){}         (assign-later) old: ok      new: ok
//   function g(){}                    (declaration)  old: ok      new: ok
const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');

function diagnostics(code, targetVersion) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const lexer = new UcodeLexer(code, { rawMode: true });
  const ast = new UcodeParser(lexer.tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd(), targetVersion }).analyze(ast);
  return [...lexer.errors, ...result.diagnostics];
}
const gates = (code, tv) => diagnostics(code, tv).filter((d) => String(d.code) === 'UC6005');

test('let f = function g(){} -> UC6005 ERROR on 25.12, clean on main', () => {
  const code = 'let f = function g(n) { return n; };\nprint(f(1), "\\n");\n';
  const on2512 = gates(code, '25.12');
  expect(on2512.length).toBe(1);
  expect(on2512[0].severity).toBe(1); // Error, no strict-mode gate: compile failure class
  expect(gates(code, 'main').length).toBe(0);
});

test('const initializer is flagged too', () => {
  expect(gates('const f = function g() { return 1; };\nprint(f(), "\\n");\n', '25.12').length).toBe(1);
});

test('named funcexpr NESTED in the initializer (object property) is flagged', () => {
  expect(gates('let o = { m: function g() { return 7; } };\nprint(o.m(), "\\n");\n', '25.12').length).toBe(1);
});

test('named funcexpr as a call argument INSIDE an initializer is flagged', () => {
  expect(gates('let r = sort([3,1], function cmp(a,b) { return a - b; });\nprint(r, "\\n");\n', '25.12').length).toBe(1);
});

test('name identical to the variable is still flagged', () => {
  expect(gates('let f = function f(n) { return n < 2 ? 1 : n * f(n - 1); };\nprint(f(4), "\\n");\n', '25.12').length).toBe(1);
});

test('anonymous initializer, statement IIFE, bare-statement callback, declaration: all clean', () => {
  for (const code of [
    'let f = function (n) { return n; };\nprint(f(1), "\\n");\n',
    '!function g() { print("x", "\\n"); }();\n',
    'sort([1], function cmp(a, b) { return a - b; });\n',
    'function g() { return 1; }\nprint(g(), "\\n");\n',
  ]) {
    expect(gates(code, '25.12').length).toBe(0);
  }
});

test('assignment AFTER declaration is clean (only declarator initializers corrupt)', () => {
  expect(gates('let f;\nf = function g(n) { return n; };\nprint(f(1), "\\n");\n', '25.12').length).toBe(0);
});

test('nested function bodies attribute to the INNER declarator only (one flag, not two)', () => {
  const code = 'let x = function () { let y = function g() { return 1; }; return y(); };\nprint(x(), "\\n");\n';
  expect(gates(code, '25.12').length).toBe(1);
});

test('diagnostic anchors on the function name and mentions both names', () => {
  const code = 'let f = function g(n) { return n; };\nprint(f(1), "\\n");\n';
  const [d] = gates(code, '25.12');
  expect(d.message).toContain('`g`');
  expect(d.message).toContain('`f`');
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  expect(doc.offsetAt(d.range.start)).toBe(code.indexOf('g(n)'));
});
