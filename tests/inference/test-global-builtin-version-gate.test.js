// Per-version bring-up of OpenWrt's built-in GLOBAL scope. Ground-truthed by introspecting
// `for (k in global)` on every release container (22.03/23.05/24.10/25.12/main): the global
// scope is IDENTICAL across releases EXCEPT the top-level `signal()` builtin, added in 23.05
// (absent from 22.03). So calling `signal()` on a 22.03 target is version-gated (UC6005).
// (Distinct from `uloop.signal`, gated separately as a module function.)
import { test, expect, describe } from 'bun:test';
const path = require('path');
const { UcodeLexer } = require(path.resolve('src/lexer/ucodeLexer'));
const { UcodeParser } = require(path.resolve('src/parser/ucodeParser'));
const { SemanticAnalyzer } = require(path.resolve('src/analysis/semanticAnalyzer'));
const { TextDocument } = require('vscode-languageserver-textdocument');

function diags(code, targetVersion) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
  return new SemanticAnalyzer(doc, { enableTypeChecking: true, targetVersion }).analyze(ast).diagnostics;
}
const u6005 = (code, tv) => diags(code, tv).filter(d => d.code === 'UC6005' && /signal/.test(d.message));

const CALL = 'signal(15, function() { print("term"); });\n';

test('signal() is version-gated on 22.03 (added in 23.05)', () => {
  const ds = u6005(CALL, '22.03');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toMatch(/requires OpenWrt 23\.05/);
});

describe('signal() is NOT gated on 23.05 and later', () => {
  for (const tv of ['23.05', '24.10', '25.12', 'main']) {
    test(`${tv}: no UC6005 for signal()`, () => {
      expect(u6005(CALL, tv).length).toBe(0);
    });
  }
});

test('a user-defined signal() (shadow) is exempt on 22.03', () => {
  expect(u6005('function signal(a, b) { return a; }\nsignal(15, 0);\n', '22.03').length).toBe(0);
});

test('a non-gated builtin (print) is never flagged on 22.03', () => {
  expect(diags('print("hi");\n', '22.03').filter(d => d.code === 'UC6005').length).toBe(0);
});

test('default target (25.12) does not gate signal()', () => {
  expect(diags(CALL).filter(d => d.code === 'UC6005').length).toBe(0);
});
