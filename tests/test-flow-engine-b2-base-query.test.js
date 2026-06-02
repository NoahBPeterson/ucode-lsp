const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { FlowTypeEngine, makeAssignmentTransfer } = require('../src/analysis/flowTypeEngine');
const { getUnionTypes, UcodeType } = require('../src/analysis/symbolTable');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');
const { CFGBuilder } = require('../src/analysis/cfg/cfgBuilder');

// Phase B / B2: the reassignment-narrowed BASE query. baseTypeAt(var, offset)
// returns the dataflow type entering the statement at offset — the base a guard
// layer (collectGuards) narrows further. This is the value effectiveSymbolType
// could not provide (Phase A step 2 / T55).

function engineFor(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  const fn = ast.body.find(s => s.type === 'FunctionDeclaration');
  const cfg = new CFGBuilder('f').build(fn.body);
  const literalType = (n) => {
    const v = n.value;
    if (typeof v === 'string') return UcodeType.STRING;
    if (typeof v === 'number') return Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE;
    if (typeof v === 'boolean') return UcodeType.BOOLEAN;
    return UcodeType.NULL;
  };
  const typeOf = (node) => result.typeChecker.getTypeOf(node) ?? (node.type === 'Literal' ? literalType(node) : undefined);
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf));
  engine.compute();
  return { engine, code };
}
const typeStr = (t) => t === undefined ? 'undefined' : (typeof t === 'string' ? t : getUnionTypes(t).map(String).sort().join('|'));
// offset of the `x` inside the (unique) `trim(x)` probe
const probeX = (code) => code.indexOf('trim(x)') + 'trim('.length;

test('base at use site reflects the declared type', () => {
  const { engine, code } = engineFor(`import * as fs from 'fs'; function f(p) { let x = fs.readfile(p); let r = trim(x); }`);
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('null|string');
});

test('base reflects a prior reassignment (the T55-class win)', () => {
  // x = "fixed" before the use → base is string, NOT string|null
  const { engine, code } = engineFor(`import * as fs from 'fs'; function f(p) { let x = fs.readfile(p); x = "fixed"; let r = trim(x); }`);
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('string');
});

test('base after a branch merge is the join of both paths', () => {
  // if(p){ x="a" } (no else) → after, x is "a"(string) joined with fallthrough(string|null) = string|null
  const { engine, code } = engineFor(`import * as fs from 'fs'; function f(p) { let x = fs.readfile(p); if (p) { x = "a"; } let r = trim(x); }`);
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('null|string');
});

test('base inside a branch reflects the in-branch reassignment', () => {
  // inside the then-block, x was just set to "a" → string
  const { engine, code } = engineFor(`import * as fs from 'fs'; function f(p) { let x = fs.readfile(p); if (p) { x = "a"; let r = trim(x); } }`);
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('string');
});
