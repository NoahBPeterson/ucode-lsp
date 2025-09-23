import { test, expect } from 'bun:test';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeType } from '../src/analysis/symbolTable.ts';

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens);
  const parseResult = parser.parse();

  const document = TextDocument.create('test://object-property-type.uc', 'ucode', 1, code);
  const analyzer = new SemanticAnalyzer(document, {
    enableScopeAnalysis: true,
    enableTypeChecking: true,
    enableUnusedVariableDetection: false,
    enableShadowingWarnings: false,
  });

  return analyzer.analyze(parseResult.ast);
}

test('infers property types on plain objects', () => {
  const code = `
'use strict';

let zea = {};
zea.lol = "lol";
let efff = zea.lol;
`;

  const result = analyze(code);
  const zeaSymbol = result.symbolTable.lookup('zea');
  const efffSymbol = result.symbolTable.lookup('efff');

  expect(zeaSymbol).toBeTruthy();
  expect(efffSymbol).toBeTruthy();

  const propertyType = zeaSymbol?.propertyTypes?.get('lol');
  expect(propertyType).toBe(UcodeType.STRING);
  expect(efffSymbol?.dataType).toBe(UcodeType.STRING);
});

test('propagates inferred property types through multiple assignments', () => {
  const code = `
'use strict';

let obj = {};
obj.name = "ucode";
let alias = obj;
let extracted = alias.name;
`;

  const result = analyze(code);
  const objSymbol = result.symbolTable.lookup('obj');
  const aliasSymbol = result.symbolTable.lookup('alias');
  const extractedSymbol = result.symbolTable.lookup('extracted');

  expect(objSymbol?.propertyTypes?.get('name')).toBe(UcodeType.STRING);
  expect(aliasSymbol?.propertyTypes?.get('name')).toBe(UcodeType.STRING);
  expect(extractedSymbol?.dataType).toBe(UcodeType.STRING);
});
