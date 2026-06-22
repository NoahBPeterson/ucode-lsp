const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');
const { typeToString } = require('../../src/analysis/symbolTable');

// `fs.open(...)` used WITHOUT importing fs is invalid (UC3006). It must not get a
// confident `fs.file` type — that previously made the broken/unimported call MORE
// specific than the correct imported call (`fs.file | null`). Now: unimported →
// unknown; imported → `fs.file | null` regardless of arguments.

function hType(code) {
  const doc = { getText: () => code, positionAt: (o) => ({ line: 0, character: o }), offsetAt: (p) => p.character, uri: 'file:///t.uc', languageId: 'ucode', version: 1 };
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const r = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
  const h = r.symbolTable.lookupAtPosition('h', code.indexOf('let h') + 4);
  return h ? typeToString(h.dataType) : '?';
}

test('unimported fs.open() does not get a confident fs.file type', () => {
  expect(hType(`function f(){ let h = fs.open('/', 'r'); }`)).toBe('unknown');
  expect(hType(`function f(){ let h = fs.open(); }`)).toBe('unknown');
});

test('imported fs.open() is fs.file | null regardless of arguments', () => {
  expect(hType(`import * as fs from 'fs';\nfunction f(){ let h = fs.open('/', 'r'); }`)).toBe('fs.file | null');
  expect(hType(`import * as fs from 'fs';\nfunction f(){ let h = fs.open(); }`)).toBe('fs.file | null');
});
