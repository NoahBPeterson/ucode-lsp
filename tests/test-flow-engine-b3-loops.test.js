const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { FlowTypeEngine, makeAssignmentTransfer } = require('../src/analysis/flowTypeEngine');
const { getUnionTypes, UcodeType } = require('../src/analysis/symbolTable');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');
const { CFGBuilder } = require('../src/analysis/cfg/cfgBuilder');

// Phase B / B3: loops. The worklist must reach a fixpoint over the loop backedge
// (the type lattice is finite-height, so monotone joins converge), without
// hitting the widening cap, and produce the join of all paths reaching a point.

function engineFor(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  const fn = ast.body.find(s => s.type === 'FunctionDeclaration');
  const cfg = new CFGBuilder('f').build(fn.body);
  const litT = (n) => { const v = n.value; return typeof v === 'string' ? UcodeType.STRING : typeof v === 'number' ? (Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE) : typeof v === 'boolean' ? UcodeType.BOOLEAN : UcodeType.NULL; };
  const typeOf = (n) => result.typeChecker.getTypeOf(n) ?? (n.type === 'Literal' ? litT(n) : undefined);
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf));
  engine.compute();
  return { engine, cfg, code };
}
const typeStr = (t) => t === undefined ? 'undefined' : (typeof t === 'string' ? t : getUnionTypes(t).map(String).sort().join('|'));
const probeX = (code) => code.indexOf('trim(x)') + 'trim('.length;

test('for-loop with a same-type reassignment converges (no cap-out)', () => {
  const { engine, cfg, code } = engineFor(`function f() { let x = "a"; for (let i = 0; i < 3; i++) { x = "b"; } let r = trim(x); }`);
  expect(engine.iterations).toBeLessThan(cfg.blocks.length * cfg.blocks.length); // reached a fixpoint
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('string'); // "a" ∪ "b" = string
});

test('while-loop reassigning to a nullable joins into the post-loop type', () => {
  const { engine, cfg, code } = engineFor(`import * as fs from 'fs'; function f(p) { let x = "a"; while (p) { x = fs.readfile(p); } let r = trim(x); }`);
  expect(engine.iterations).toBeLessThan(cfg.blocks.length * cfg.blocks.length);
  // after the loop: "a"(string) joined with readfile()(string|null) = string|null
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('null|string');
});

test('inside the loop body, the base reflects the in-loop reassignment', () => {
  const { engine, code } = engineFor(`import * as fs from 'fs'; function f(p) { let x = "a"; while (p) { x = fs.readfile(p); let r = trim(x); } }`);
  // first body iteration sees x just assigned readfile() = string|null (joined with "a" via backedge)
  expect(typeStr(engine.baseTypeAt('x', probeX(code)))).toBe('null|string');
});
