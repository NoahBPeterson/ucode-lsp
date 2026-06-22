const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { FlowTypeEngine, makeAssignmentTransfer } = require('../../src/analysis/flowTypeEngine');
const { getUnionTypes, UcodeType } = require('../../src/analysis/symbolTable');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');
const { CFGBuilder } = require('../../src/analysis/cfg/cfgBuilder');

// Phase B / B4: validation. The engine must reproduce the reassignment-narrowed
// BASE that the diagnostic path gets from getFullTypeFromNode (the value
// effectiveSymbolType lacked — Phase A step 2 / T55), so that a future B5 can use
// it as a unified base. Entry env is seeded with parameter types.
// (Scale readiness — engine over 318 functions in real pbr/mwan4/hostapd/unet
// files: 0 crashes, 0 cap-outs, max 164 iterations — verified one-off, not here.)

function engineFor(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  const fn = ast.body.find(s => s.type === 'FunctionDeclaration');
  const cfg = new CFGBuilder('f').build(fn.body);
  const litT = (n) => { const v = n.value; return typeof v === 'string' ? UcodeType.STRING : typeof v === 'number' ? (Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE) : typeof v === 'boolean' ? UcodeType.BOOLEAN : UcodeType.NULL; };
  const typeOf = (n) => result.typeChecker.getTypeOf(n) ?? (n.type === 'Literal' ? litT(n) : undefined);
  // Seed parameters from the function symbol's resolved signature (ParamInfo).
  const entryEnv = new Map();
  const fnSym = result.symbolTable.lookup(fn.id.name);
  for (const pi of (fnSym?.parameters ?? [])) entryEnv.set(pi.name, pi.type);
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf), entryEnv);
  engine.compute();
  return { engine, code };
}
const typeStr = (t) => t === undefined ? 'undefined' : (typeof t === 'string' ? t : getUnionTypes(t).map(String).sort().join('|'));
const probe = (code, varName) => { const p = `trim(${varName})`; return code.indexOf(p) + `trim(`.length; };

test('declared local type flows to a use', () => {
  const { engine, code } = engineFor(`function f() { let s = "hi"; let r = trim(s); }`);
  expect(typeStr(engine.baseTypeAt('s', probe(code, 's')))).toBe('string');
});

test('T55 shape: a conditionally-reassigned string stays string at the use', () => {
  const { engine, code } = engineFor(
    `function parse_int() {\n` +
    `  let strval = "abc";\n` +
    `  if (strval == "-") strval = substr(strval, 1);\n` + // reassign to substr(string)=string
    `  let r = trim(strval);\n` +
    `}`);
  // string ∪ substr(string)=string on the reassignment path → string (not string|null).
  // This is exactly the reassignment-narrowed base the diagnostic path needs (T55).
  expect(typeStr(engine.baseTypeAt('strval', probe(code, 'strval')))).toBe('string');
});

test('reassigning a string to a nullable widens the base', () => {
  const { engine, code } = engineFor(
    `import * as fs from 'fs';\nfunction f(p) { let s = "abc"; s = fs.readfile(p); let r = trim(s); }`);
  expect(typeStr(engine.baseTypeAt('s', probe(code, 's')))).toBe('null|string');
});
