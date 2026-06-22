const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { FlowTypeEngine, makeAssignmentTransfer, joinTypes } = require('../../src/analysis/flowTypeEngine');
const { getUnionTypes, UcodeType } = require('../../src/analysis/symbolTable');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');
const { CFGBuilder } = require('../../src/analysis/cfg/cfgBuilder');

// Phase C / C1: the engine folds GUARDS into the dataflow via an edge transfer,
// and excludes unreachable blocks so a dangling post-`return` block can't
// re-widen a guard-narrowed merge. These tests exercise the engine mechanics
// directly with a TRIVIAL edge guard (narrow a named var to a fixed type on the
// positive/negative edge) — the real guard extraction is covered end-to-end by
// test-hover-type-narrowing + the differential harness.

const typeStr = (t) => t === undefined ? 'undefined' : (typeof t === 'string' ? t : getUnionTypes(t).map(String).sort().join('|'));

function build(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  const fn = ast.body.find(s => s.type === 'FunctionDeclaration');
  const cfg = new CFGBuilder('f').build(fn.body);
  const litT = (n) => { const v = n.value; return typeof v === 'string' ? UcodeType.STRING : typeof v === 'number' ? (Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE) : typeof v === 'boolean' ? UcodeType.BOOLEAN : UcodeType.NULL; };
  const typeOf = (n) => result.typeChecker.getTypeOf(n) ?? (n.type === 'Literal' ? litT(n) : undefined);
  return { cfg, code, typeOf, fnSym: result.symbolTable.lookup(fn.id.name) };
}
const probe = (code, varName) => code.indexOf(`trim(${varName})`) + 'trim('.length;

test('joinTypes treats unknown as the lattice top (T ∪ unknown = unknown)', () => {
  expect(typeStr(joinTypes(UcodeType.STRING, UcodeType.UNKNOWN))).toBe('unknown');
  expect(typeStr(joinTypes(UcodeType.UNKNOWN, UcodeType.STRING))).toBe('unknown');
  // ordinary union still unions
  expect(typeStr(joinTypes(UcodeType.STRING, UcodeType.NULL))).toBe('null|string');
});

test('a positive-edge guard narrows the env entering the then-block', () => {
  // if (x) { trim(x); }  — the trivial guard narrows `x` to STRING on the true edge.
  const { cfg, code, typeOf } = build(`function f(x) { if (x) { let r = trim(x); } }`);
  const entryEnv = new Map([['x', UcodeType.UNKNOWN]]);
  const edgeGuard = (_cond, isNeg, env) => { if (!isNeg && env.has('x')) env.set('x', UcodeType.STRING); };
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf), entryEnv, edgeGuard);
  engine.compute();
  expect(typeStr(engine.baseTypeAt('x', probe(code, 'x')))).toBe('string');
});

test('an unreachable post-return block does not re-widen a guard-narrowed merge', () => {
  // early-exit: `if (...) return;` leaves a dangling `after.return` block with no
  // predecessors. Without reachability filtering it would be seeded with the
  // param env and pollute the merge to `string|unknown`.
  const { cfg, code, typeOf } = build(`function f(x) { if (x) return; let r = trim(x); }`);
  const entryEnv = new Map([['x', UcodeType.UNKNOWN]]);
  // negative edge (the fall-through after the returning then) narrows x to STRING.
  const edgeGuard = (_cond, isNeg, env) => { if (isNeg && env.has('x')) env.set('x', UcodeType.STRING); };
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf), entryEnv, edgeGuard);
  engine.compute();
  expect(typeStr(engine.baseTypeAt('x', probe(code, 'x')))).toBe('string');
});

test('a plain if-merge (no early exit) rejoins to unknown via the top rule', () => {
  // if (x) { ... } trim(x);  — the then-path narrows, the skip-path is unknown,
  // so the post-if merge is unknown (top), NOT string|unknown.
  const { cfg, code, typeOf } = build(`function f(x) { if (x) { let q = 1; } let r = trim(x); }`);
  const entryEnv = new Map([['x', UcodeType.UNKNOWN]]);
  const edgeGuard = (_cond, isNeg, env) => { if (!isNeg && env.has('x')) env.set('x', UcodeType.STRING); };
  const engine = new FlowTypeEngine(cfg, makeAssignmentTransfer(typeOf), entryEnv, edgeGuard);
  engine.compute();
  expect(typeStr(engine.baseTypeAt('x', probe(code, 'x')))).toBe('unknown');
});
