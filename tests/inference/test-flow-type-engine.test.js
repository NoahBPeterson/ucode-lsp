const { test, expect } = require('bun:test');
const { joinTypes, joinEnvironments, FlowTypeEngine } = require('../../src/analysis/flowTypeEngine');
const { UcodeType, getUnionTypes, isUnionType } = require('../../src/analysis/symbolTable');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { CFGBuilder } = require('../../src/analysis/cfg/cfgBuilder');

// Phase B / B0: the dataflow framework (worklist + fixpoint + lattice join). The
// engine is not yet wired to any consumer; these test the framework in isolation.

test('joinTypes: idempotent, and unions distinct types', () => {
  expect(joinTypes(UcodeType.STRING, UcodeType.STRING)).toBe(UcodeType.STRING);

  const u = joinTypes(UcodeType.STRING, UcodeType.NULL); // string ∪ null
  expect(isUnionType(u)).toBe(true);
  const members = getUnionTypes(u).map(String).sort();
  expect(members).toEqual(['null', 'string']);

  // join is absorptive: (string|null) ∪ string === string|null
  const u2 = joinTypes(u, UcodeType.STRING);
  expect(getUnionTypes(u2).map(String).sort()).toEqual(['null', 'string']);
});

test('joinEnvironments: keep keys present on ALL paths, joined; drop the rest', () => {
  const a = new Map([['x', UcodeType.STRING], ['y', UcodeType.INTEGER]]);
  const b = new Map([['x', UcodeType.NULL]]);
  const merged = joinEnvironments([a, b]);
  expect(merged.has('y')).toBe(false);                 // only on path a
  expect(getUnionTypes(merged.get('x')).map(String).sort()).toEqual(['null', 'string']);

  // no predecessors → empty; single predecessor → passthrough
  expect(joinEnvironments([]).size).toBe(0);
  expect(joinEnvironments([a])).toBe(a);
});

test('engine reaches a fixpoint over an if/else CFG (identity transfer)', () => {
  const code = `function f(x) { if (x) { let a = 1; } else { let b = 2; } let c = 3; }`;
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const cfg = new CFGBuilder('t').build(ast);

  const engine = new FlowTypeEngine(cfg); // default identity transfer
  engine.compute();

  expect(engine.iterations).toBeGreaterThan(0);
  // Terminated by reaching a fixpoint, NOT by hitting the widening cap.
  expect(engine.iterations).toBeLessThan(cfg.blocks.length * cfg.blocks.length);
  // Identity transfer over empty inputs → every block's env is empty.
  for (const b of cfg.blocks) {
    expect(engine.getInEnv(b.id).size).toBe(0);
    expect(engine.getOutEnv(b.id).size).toBe(0);
  }
});
