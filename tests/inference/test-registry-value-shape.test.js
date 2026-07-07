// Registry / dictionary value-shape inference — Gap 1 & Gap 2.
// A factory-scoped `{}` map written through a setter and read through a getter
// carries its inferred value shape (valuePropertyTypes) out through the getter:
//   Gap 1: `return map[k]` populates the getter's returnPropertyTypes.
//   Gap 2: `get(x).prop` (member access directly on the call result) resolves.
// See docs/registry-value-shape-inference.md.
const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer.ts');
const { typeToString } = require('../../src/analysis/symbolTable.ts');

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  const parseResult = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true });
  return { result: analyzer.analyze(parseResult.ast), code };
}
const symAt = (a, name, near) => a.result.symbolTable.lookupAtPosition(name, a.code.indexOf(near))
  ?? a.result.symbolTable.lookup(name);

const REGISTRY = `function create_pbr() {
  let iface_registry = {};
  function set_interface(iface, data) {
    iface_registry[iface] = data;
  }
  function get_interface(iface) {
    return iface_registry[iface];
  }
  set_interface('wan', { mark: 1, chain_name: "c", strategy_name: "s" });
  let sd = get_interface('wan');
  let bn = sd.chain_name;
  let cn = get_interface('lan').chain_name;
  return [bn, cn];
}`;

test('Gap 1: getter return carries the registry value shape (returnPropertyTypes)', () => {
  const a = analyze(REGISTRY);
  const gi = symAt(a, 'get_interface', 'return iface_registry');
  expect(gi?.returnPropertyTypes ? [...gi.returnPropertyTypes.keys()].sort() : []).
    toEqual(['chain_name', 'mark', 'strategy_name']);
});

test('Gap 1: `let v = get(x); v.prop` binding copies the shape', () => {
  const a = analyze(REGISTRY);
  const sd = symAt(a, 'sd', 'sd.chain_name');
  expect(sd?.propertyTypes ? [...sd.propertyTypes.keys()].sort() : []).
    toEqual(['chain_name', 'mark', 'strategy_name']);
});

test('Gap 2: `get(x).prop` (direct chain) resolves the property type', () => {
  const a = analyze(REGISTRY);
  const cn = symAt(a, 'cn', 'return [bn, cn]');
  expect(cn ? typeToString(cn.dataType) : 'NF').toBe('string');
});
