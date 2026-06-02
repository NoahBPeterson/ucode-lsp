const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { FlowTypeEngine, makeAssignmentTransfer } = require('../src/analysis/flowTypeEngine');
const { getUnionTypes, UcodeType } = require('../src/analysis/symbolTable');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');
const { CFGBuilder } = require('../src/analysis/cfg/cfgBuilder');

// Phase B / B1: the assignment/declaration transfer. Functions are opaque in the
// top-level CFG, so the engine runs on a PER-FUNCTION CFG built from the body.
// env[x] tracks the CHECKED type of the RHS at each declaration/assignment.

// Analyze `code`, build a CFG for the first function's body, run the engine with
// the assignment transfer, and return the final environment (exit-block input).
function finalEnv(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  const fn = ast.body.find(s => s.type === 'FunctionDeclaration');
  const cfg = new CFGBuilder('f').build(fn.body);
  // Robust node-typer: the cached checked type (calls/member access — carries
  // reassignment narrowing) with a literal fallback (literal inits aren't cached).
  // B5's production provider will be a single side-effect-free node-typer.
  const literalType = (n) => {
    const v = n.value;
    if (typeof v === 'string') return UcodeType.STRING;
    if (typeof v === 'number') return Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE;
    if (typeof v === 'boolean') return UcodeType.BOOLEAN;
    return UcodeType.NULL;
  };
  const typeOf = (node) => {
    const c = result.typeChecker.getTypeOf(node);
    if (c !== undefined) return c;
    if (node.type === 'Literal') return literalType(node);
    return undefined;
  };
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf));
  engine.compute();
  return engine.getInEnv(cfg.exit.id);
}
const typeStr = (t) => t === undefined ? 'undefined'
  : (typeof t === 'string' ? t : getUnionTypes(t).map(String).sort().join('|'));

test('declaration: env[x] = checked init type (string|null from fs.readfile)', () => {
  const env = finalEnv(`import * as fs from 'fs'; function f(p) { let x = fs.readfile(p); }`);
  expect(typeStr(env.get('x'))).toBe('null|string');
});

test('declaration: literal init', () => {
  const env = finalEnv(`function f() { let s = "hi"; }`);
  expect(typeStr(env.get('s'))).toBe('string');
});

test('uninitialized declaration: env[x] = null', () => {
  const env = finalEnv(`function f() { let x; }`);
  expect(typeStr(env.get('x'))).toBe('null');
});

test('reassignment updates env: nullable, then narrowed by a literal assignment', () => {
  // let x = readfile(); → string|null ; then x = "fixed"; → string
  const env = finalEnv(`import * as fs from 'fs'; function f(p) { let x = fs.readfile(p); x = "fixed"; }`);
  expect(typeStr(env.get('x'))).toBe('string');
});

test('reassignment to a wider type widens env', () => {
  // let x = "a"; → string ; then x = readfile(); → string|null
  const env = finalEnv(`import * as fs from 'fs'; function f(p) { let x = "a"; x = fs.readfile(p); }`);
  expect(typeStr(env.get('x'))).toBe('null|string');
});
