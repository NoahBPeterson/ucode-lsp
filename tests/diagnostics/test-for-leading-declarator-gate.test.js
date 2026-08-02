// docs/for-loop-leading-declarator.md - version-gated diagnostic for the dropped
// leading declarator in a counting for loop.
//
// Oracle matrix (old binary vs master 81205a2, verified 2026-08-01):
//   for (let x, y = 0; ...) { x = 1; }      old: x is an implicit GLOBAL (non-strict)
//                                                / "access to undeclared variable" (strict)
//                                           new: x is a proper loop-local, initialized null
//   for (let x = 7, y = 0; ...)             both: fine (initializer saves it)
//   for (let y = 0; ...)                    both: fine (single declarator is forwarded)
//   for (let x, y, z = 0; ...)              old: only x dropped; y and z fine
//   for (let k, v in obj)                   both: fine (for-in path, not this ticket)
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

const LOOP = 'for (let acc, i = 0; i < 3; i++) {\n    acc ??= 0;\n    acc += i;\n}\n';

test('for (let acc, i = 0; ...) -> UC6005 WARNING on 25.12, clean on main', () => {
  const on2512 = gates(LOOP, '25.12');
  expect(on2512.length).toBe(1);
  expect(on2512[0].severity).toBe(2); // Warning in non-strict: silent global leak
  expect(on2512[0].message).toContain('`acc`');
  expect(gates(LOOP, 'main').length).toBe(0);
});

test("under 'use strict' the gate escalates to ERROR (guaranteed runtime reference error)", () => {
  const code = `'use strict';\n${LOOP}`;
  const on2512 = gates(code, '25.12');
  expect(on2512.length).toBe(1);
  expect(on2512[0].severity).toBe(1);
});

test('diagnostic anchors on the leading declarator', () => {
  const [d] = gates(LOOP, '25.12');
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, LOOP);
  expect(doc.offsetAt(d.range.start)).toBe(LOOP.indexOf('acc'));
});

test('initialized leading declarator, single declarator, for-in two-var: all clean', () => {
  for (const code of [
    'for (let x = 7, y = 0; y < 1; y++) { x += y; }\n',
    'for (let y = 0; y < 1; y++) { print(y, "\\n"); }\n',
    'let o = { a: 1 };\nfor (let k, v in o) { print(k, v, "\\n"); }\n',
  ]) {
    expect(gates(code, '25.12').length).toBe(0);
  }
});

test('three declarators: only the first is flagged', () => {
  const code = 'for (let x, y, z = 0; z < 1; z++) { y = 1; x = 2; }\n';
  const on2512 = gates(code, '25.12');
  expect(on2512.length).toBe(1);
  expect(on2512[0].message).toContain('`x`');
});
