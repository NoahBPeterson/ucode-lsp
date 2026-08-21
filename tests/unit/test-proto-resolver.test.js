// Direct unit tests for src/analysis/protoResolver.ts — the single model of
// ucode's proto() mechanism (docs/prototypes-as-a-first-class-concept.md).
//
// Runtime ground truth (types.c/lib.c, verified LIVE on owrt-main 2026-08-14):
// proto(v, P) returns v with prototype P attached and type(v) UNCHANGED; member
// lookup walks the chain (own shadows prototype); only arrays/objects carry a
// prototype; a second proto(v, P2) REPLACES; 1-arg proto(v) READS.
import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../../src/lexer/index.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { asProtoCall, collectPrototypeInstances, collectPrototypeMethodFunctions, declaratorInitNear, detectProtoCycles, instanceBaseType } from '../../src/analysis/protoResolver.ts';
import { walkAst } from '../../src/ast/astChildren.ts';
import { UcodeType } from '../../src/analysis/symbolTable.ts';

function parse(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  return parser.parse().ast;
}

function firstCall(ast) {
  let found = null;
  walkAst(ast, (n) => {
    if (!found && n.type === 'CallExpression') found = n;
  });
  return found;
}

describe('asProtoCall', () => {
  test('matches the 2-arg attaching form', () => {
    const ast = parse('proto(v, P);');
    const pc = asProtoCall(firstCall(ast));
    expect(pc).not.toBeNull();
    expect(pc.value.type).toBe('Identifier');
    expect(pc.protoExpr.type).toBe('Identifier');
  });

  test('does NOT match the 1-arg reading form', () => {
    const ast = parse('proto(v);');
    expect(asProtoCall(firstCall(ast))).toBeNull();
  });

  test('does NOT match other callees or non-calls', () => {
    expect(asProtoCall(firstCall(parse('protox(v, P);')))).toBeNull();
    expect(asProtoCall(firstCall(parse('o.proto(v, P);')))).toBeNull();
    expect(asProtoCall(null)).toBeNull();
  });
});

describe('collectPrototypeInstances', () => {
  test('identifier prototype resolves through its declarator', () => {
    const ast = parse('const P = { m: function() {} };\nlet w = proto({ a: 1 }, P);\n');
    const reg = collectPrototypeInstances(ast);
    expect(reg.size).toBe(1);
    const [lit, instances] = [...reg.entries()][0];
    expect(lit.type).toBe('ObjectExpression');
    expect(instances.length).toBe(1);
    expect(instances[0].type).toBe('ObjectExpression');
  });

  test('inline prototype literal maps directly', () => {
    const ast = parse('let w = proto([1], { m: function() {} });\n');
    const reg = collectPrototypeInstances(ast);
    expect(reg.size).toBe(1);
    expect([...reg.values()][0][0].type).toBe('ArrayExpression');
  });

  test('chained prototype declarator (`let P = proto({…}, base)`) unwraps to its method table', () => {
    const ast = parse('const base = { b: function() {} };\nconst P = proto({ m: function() {} }, base);\nlet w = proto({ a: 1 }, P);\n');
    const reg = collectPrototypeInstances(ast);
    // Two prototype literals: base (instance = P's method table) and P's own table (instance = w's literal).
    expect(reg.size).toBe(2);
    for (const instances of reg.values()) expect(instances.length).toBe(1);
  });

  test('a name declared twice with object literals is ambiguous — skipped', () => {
    const ast = parse('let P = { a: 1 };\nP = 0;\nlet P2 = 1;\nif (P2) { let P = { b: 2 }; }\nlet w = proto({}, P);\n');
    // Two `P = {…}` declarators compete; neither is trusted.
    const reg = collectPrototypeInstances(ast);
    expect(reg.size).toBe(0);
  });

  test('multiple instances of one prototype accumulate', () => {
    const ast = parse('const P = { m: function() {} };\nlet a = proto({ x: 1 }, P);\nlet b = proto([1], P);\n');
    const reg = collectPrototypeInstances(ast);
    expect([...reg.values()][0].length).toBe(2);
  });
});

describe('instanceBaseType', () => {
  const casesAst = parse([
    'let obj = proto({ a: 1 }, P);',
    'let arr = proto([1, 2], P);',
    'let named = { n: 1 };',
    'let viaName = proto(named, P);',
    'let chained = proto(proto([0], A), B);',
    'let opaque = proto(mystery(), P);',
  ].join('\n'));
  const calls = [];
  walkAst(casesAst, (n) => {
    const pc = asProtoCall(n);
    if (pc) calls.push(pc);
  });

  test('object literal → OBJECT', () => {
    expect(instanceBaseType(calls[0].value, casesAst)).toBe(UcodeType.OBJECT);
  });
  test('array literal → ARRAY', () => {
    expect(instanceBaseType(calls[1].value, casesAst)).toBe(UcodeType.ARRAY);
  });
  test('identifier resolves through its unique declarator', () => {
    expect(instanceBaseType(calls[2].value, casesAst)).toBe(UcodeType.OBJECT);
  });
  test('nested proto() chain unwraps to the innermost value', () => {
    expect(instanceBaseType(calls[3].value, casesAst)).toBe(UcodeType.ARRAY);
  });
  test('an unprovable value returns null — never a guess', () => {
    expect(instanceBaseType(calls[calls.length - 1].value, casesAst)).toBeNull();
  });
});

describe('collectPrototypeMethodFunctions', () => {
  test('shorthand and key:fnName references map function names to their tables', () => {
    const ast = parse('function setup() {}\nfunction halt() {}\nconst P = { setup, stop: halt, inline: function() {} };\nlet w = proto({}, P);\n');
    const reg = collectPrototypeMethodFunctions(collectPrototypeInstances(ast));
    expect([...reg.keys()].sort()).toEqual(['halt', 'setup']);
  });

  test('a table with NO instances contributes nothing (plain namespace objects keep their meaning)', () => {
    const ast = parse('function setup() {}\nconst ns = { setup };\nprint(ns);\n');
    const reg = collectPrototypeMethodFunctions(collectPrototypeInstances(ast));
    expect(reg.size).toBe(0);
  });
});

describe('declaratorInitNear (scope-aware instance resolution)', () => {
  test('picks the same-function declarator over an earlier one in another function', () => {
    const code = [
      'function other() {',
      '  let wdev = fetch();',   // decoy in a different function
      '  print(wdev);',
      '}',
      'function make() {',
      '  let wdev = { a: 1 };',
      '  return proto(wdev, P);',
      '}',
    ].join('\n');
    const ast = parse(code);
    let ref = null;
    walkAst(ast, (n) => {
      const pc = asProtoCall(n);
      if (pc) ref = pc.value;
    });
    const init = declaratorInitNear('wdev', ref.start, ast);
    expect(init).not.toBeNull();
    expect(init.type).toBe('ObjectExpression');
  });

  test('a declarator AFTER the reference is invisible', () => {
    const ast = parse('print(x);\nlet x = { a: 1 };\n');
    const printCall = firstCall(ast);
    expect(declaratorInitNear('x', printCall.arguments[0].start, ast)).toBeNull();
  });
});

describe('declaratorInitNear — ordering and scope filters', () => {
  test('two declarators in the SAME function: nearest preceding wins', () => {
    const code = [
      'function f() {',
      '  let x = { first: 1 };',
      '  print(x);',
      '  let x2 = 0;',
      '  x = null;',
      '  let x3 = { third: 3 };',
      '  print(x2, x3);',
      '}',
    ].join('\n');
    // Reuse a name deliberately shadow-free: query `x` at the print between the two.
    const ast = parse(code);
    const refPos = code.indexOf('print(x)');
    const init = declaratorInitNear('x', refPos, ast);
    expect(init).not.toBeNull();
    expect(init.type).toBe('ObjectExpression');
    expect(init.properties[0].key.value).toBe('first');
  });

  test('a function-LOCAL declarator is invisible to a top-level reference', () => {
    const code = 'function f() {\n  let x = { a: 1 };\n  print(x);\n}\nprint(x);\n';
    const ast = parse(code);
    const refPos = code.lastIndexOf('print(x)');
    expect(declaratorInitNear('x', refPos, ast)).toBeNull();
  });

  test('an inner declarator beats an outer one when both enclose the reference', () => {
    const code = 'let x = { outer: 1 };\nfunction f() {\n  let x = { inner: 2 };\n  print(x);\n}\n';
    const ast = parse(code);
    const refPos = code.indexOf('print(x)');
    const init = declaratorInitNear('x', refPos, ast);
    expect(init.properties[0].key.value).toBe('inner');
  });
});

describe('collectPrototypeMethodFunctions — multiple tables', () => {
  test('a function referenced from TWO instanced tables lists both', () => {
    const ast = parse([
      'function shared() {}',
      'const P1 = { shared };',
      'const P2 = { go: shared };',
      'let a = proto({}, P1);',
      'let b = proto({}, P2);',
    ].join('\n'));
    const reg = collectPrototypeMethodFunctions(collectPrototypeInstances(ast));
    expect(reg.get('shared').length).toBe(2);
  });
});

describe('detectProtoCycles', () => {
  test('a two-node cycle is one cycle carrying both calls', () => {
    const ast = parse('const A = { a: 1 };\nconst B = { b: 2 };\nproto(A, B);\nproto(B, A);\n');
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(2);
    expect(cycles[0].names.sort()).toEqual(['A', 'B']);
  });

  test('a self-loop proto(A, A) is a cycle', () => {
    const ast = parse('const A = { a: 1 };\nproto(A, A);\n');
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(1);
  });

  test('a three-node cycle reports all three calls once', () => {
    const ast = parse('const A = {};\nconst B = {};\nconst C = {};\nproto(A, B);\nproto(B, C);\nproto(C, A);\n');
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(3);
  });

  test('a linear chain is NOT a cycle', () => {
    const ast = parse('const A = {};\nconst B = {};\nconst C = {};\nproto(A, B);\nproto(B, C);\n');
    expect(detectProtoCycles(ast).length).toBe(0);
  });

  test('a LATER re-parent that breaks the cycle un-flags it (REPLACE semantics, final state)', () => {
    const ast = parse('const A = {};\nconst B = {};\nconst C = {};\nproto(A, B);\nproto(B, A);\nproto(B, C);\n');
    expect(detectProtoCycles(ast).length).toBe(0);
  });

  test('branches hanging OFF a cycle do not duplicate the report', () => {
    const ast = parse('const A = {};\nconst B = {};\nproto(A, B);\nproto(B, A);\nlet w = proto({ own: 1 }, A);\nlet v = proto({ o2: 2 }, B);\n');
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(2);
  });
});

// ── batch 3: 20 additional distinct cases, each walked through the
// implementation and (where a runtime claim is involved) the oracle ──────────

describe('asProtoCall — argument shapes', () => {
  test('an extra third argument still matches (runtime ignores extras — oracle: proto({x},{m},99) works)', () => {
    const ast = parse('proto(v, P, 99);');
    const pc = asProtoCall(firstCall(ast));
    expect(pc).not.toBeNull();
    expect(pc.protoExpr.name).toBe('P');
  });

  test('a lone spread argument is statically invisible — no match', () => {
    const ast = parse('proto(...args);');
    expect(asProtoCall(firstCall(ast))).toBeNull();
  });
});

describe('collectPrototypeInstances — more shapes', () => {
  test('a bare re-parent statement records the IDENTIFIER as the instance', () => {
    const ast = parse('const P = { m: function() {} };\nlet w = { a: 1 };\nproto(w, P);\n');
    const reg = collectPrototypeInstances(ast);
    expect(reg.size).toBe(1);
    expect([...reg.values()][0][0].type).toBe('Identifier');
  });

  test('proto() calls inside nested function bodies are found', () => {
    const ast = parse('const P = { m: function() {} };\nfunction make() {\n\treturn proto({ a: 1 }, P);\n}\n');
    const reg = collectPrototypeInstances(ast);
    expect(reg.size).toBe(1);
    expect([...reg.values()][0][0].type).toBe('ObjectExpression');
  });

  test('a prototype name whose declarator is NOT an object literal is not mapped', () => {
    const ast = parse('let P = getProto();\nlet w = proto({}, P);\n');
    expect(collectPrototypeInstances(ast).size).toBe(0);
  });

  test('a never-declared prototype name is not mapped', () => {
    const ast = parse('let w = proto({}, NeverDeclared);\n');
    expect(collectPrototypeInstances(ast).size).toBe(0);
  });

  test('a chained declarator whose METHOD TABLE is not a literal is not mapped', () => {
    const ast = parse('let P = proto(getBase(), base);\nlet w = proto({}, P);\n');
    expect(collectPrototypeInstances(ast).size).toBe(0);
  });

  test('a block-scoped table is still matched by name (documented name-based resolution)', () => {
    const ast = parse('function f(c) {\n\tif (c) {\n\t\tlet P = { m: function() {} };\n\t\treturn proto({ a: 1 }, P);\n\t}\n\treturn null;\n}\n');
    expect(collectPrototypeInstances(ast).size).toBe(1);
  });
});

describe('collectPrototypeMethodFunctions — property shapes', () => {
  test('computed keys are skipped (only the plain reference registers)', () => {
    const ast = parse('const key = "dyn";\nfunction fn() {}\nconst P = { [key]: fn, real: fn };\nlet w = proto({}, P);\n');
    const reg = collectPrototypeMethodFunctions(collectPrototypeInstances(ast));
    // If computed keys were followed, `fn` would appear twice.
    expect(reg.get('fn').length).toBe(1);
  });

  test('a spread element in the table is skipped without crashing', () => {
    const ast = parse('function fn() {}\nconst mixin = { extra: 1 };\nconst P = { ...mixin, m: fn };\nlet w = proto({}, P);\n');
    const reg = collectPrototypeMethodFunctions(collectPrototypeInstances(ast));
    expect(reg.get('fn').length).toBe(1);
  });
});

describe('instanceBaseType — identifier resolution limits', () => {
  test('a name declared twice (different scopes) is ambiguous → null', () => {
    const ast = parse('let z = { a: 1 };\nfunction f() {\n\tlet z = [1];\n\tprint(z);\n}\nlet w = proto(z, P);\n');
    let pc = null;
    walkAst(ast, (n) => { const c = asProtoCall(n); if (c) pc = c; });
    expect(instanceBaseType(pc.value, ast)).toBeNull();
  });

  test('a two-hop identifier chain resolves (`let alias = base`)', () => {
    const ast = parse('let base = { a: 1 };\nlet alias = base;\nlet w = proto(alias, P);\n');
    let pc = null;
    walkAst(ast, (n) => { const c = asProtoCall(n); if (c) pc = c; });
    expect(instanceBaseType(pc.value, ast)).toBe(UcodeType.OBJECT);
  });

  test('a declarator with NO initializer proves nothing → null', () => {
    const ast = parse('let solo;\nlet w = proto(solo, P);\n');
    let pc = null;
    walkAst(ast, (n) => { const c = asProtoCall(n); if (c) pc = c; });
    expect(instanceBaseType(pc.value, ast)).toBeNull();
  });
});

describe('declaratorInitNear — more scope shapes', () => {
  test('a reference inside a nested function sees a TOP-LEVEL declarator', () => {
    const code = 'let cfg = { a: 1 };\nfunction f() {\n\tprint(cfg);\n}\n';
    const ast = parse(code);
    const init = declaratorInitNear('cfg', code.indexOf('print'), ast);
    expect(init).not.toBeNull();
    expect(init.type).toBe('ObjectExpression');
  });

  test('a top-level reference picks the top-level declarator, never a function-local one', () => {
    const code = 'let cfg = { top: 1 };\nfunction f() {\n\tlet cfg = { local: 2 };\n\tprint(cfg);\n}\nprint(cfg);\n';
    const ast = parse(code);
    const init = declaratorInitNear('cfg', code.lastIndexOf('print'), ast);
    expect(init.properties[0].key.value).toBe('top');
  });

  test('an ARROW-function-local declarator is invisible outside the arrow', () => {
    const code = 'const g = () => {\n\tlet hid = { inner: 1 };\n\treturn hid;\n};\nprint(hid);\n';
    const ast = parse(code);
    expect(declaratorInitNear('hid', code.lastIndexOf('print'), ast)).toBeNull();
  });
});

describe('detectProtoCycles — more graph shapes', () => {
  test('two INDEPENDENT cycles are each reported once', () => {
    const ast = parse('const A = {};\nconst B = {};\nconst C = {};\nconst D = {};\nproto(A, B);\nproto(B, A);\nproto(C, D);\nproto(D, C);\n');
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(2);
    for (const c of cycles) expect(c.calls.length).toBe(2);
  });

  test('a declarator-bound call (`let x = proto(B, A)`) still contributes its edge', () => {
    const ast = parse('const A = { a: 1 };\nconst B = { b: 2 };\nproto(A, B);\nlet x = proto(B, A);\n');
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(2);
  });

  test('unresolvable operands (call results) are skipped — no crash, no false cycle', () => {
    const ast = parse('proto(getA(), getB());\nconst A = {};\nconst B = {};\nproto(A, B);\n');
    expect(detectProtoCycles(ast).length).toBe(0);
  });

  test('REPLACE keeps only final edges: an overwritten first target does not shield the cycle', () => {
    const code = 'const A = {};\nconst B = {};\nconst C = {};\nproto(A, C);\nproto(A, B);\nproto(B, A);\n';
    const ast = parse(code);
    const cycles = detectProtoCycles(ast);
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(2);
    // The flagged calls are the FINAL edges — proto(A, C) was replaced and must not be among them.
    const replacedStart = code.indexOf('proto(A, C)');
    for (const call of cycles[0].calls) expect(call.start).not.toBe(replacedStart);
  });
});

describe('detectProtoCycles — ρ shapes (tails into a cycle)', () => {
  const RHO = 'const a = { A: 1 };\nconst b = { B: 1 };\nconst c = { C: 1 };\nconst d = { D: 1 };\nconst e = { E: 1 };\nconst f = { F: 1 };\nconst g = { G: 1 };\nproto(a, b);\nproto(b, c);\nproto(c, d);\nproto(d, e);\nproto(e, f);\nproto(f, g);\nproto(g, d);\n';

  test('the cycle is exactly d→e→f→g; tail nodes are a, b, c', () => {
    const cycles = detectProtoCycles(parse(RHO));
    expect(cycles.length).toBe(1);
    expect(cycles[0].calls.length).toBe(4);
    expect(cycles[0].tails.map(t => t.key).sort()).toEqual(['id:a', 'id:b', 'id:c']);
  });

  test("each tail carries its full PATH to the cycle (a's path is a,b,c)", () => {
    const cycles = detectProtoCycles(parse(RHO));
    const tailA = cycles[0].tails.find(t => t.key === 'id:a');
    expect(tailA.valueNodes.length).toBe(3);
    expect(tailA.calls.length).toBe(3);
    const tailC = cycles[0].tails.find(t => t.key === 'id:c');
    expect(tailC.valueNodes.length).toBe(1);
  });

  test('joining two 2-cycles REPLACES an edge: one cycle survives, the other becomes its tail', () => {
    // One prototype slot per value ⇒ out-degree ≤ 1 ⇒ two cycles can never share
    // a node; proto(B, C) re-parents B, destroying A↔B.
    const code = 'const A = {};\nconst B = {};\nconst C = {};\nconst D = {};\nproto(A, B);\nproto(B, A);\nproto(C, D);\nproto(D, C);\nproto(B, C);\n';
    const cycles = detectProtoCycles(parse(code));
    expect(cycles.length).toBe(1);
    expect(cycles[0].keys.sort()).toEqual(['id:C', 'id:D']);
    expect(cycles[0].tails.map(t => t.key).sort()).toEqual(['id:A', 'id:B']);
  });

  test('a chain that dead-ends before any cycle is NOT a tail', () => {
    const code = 'const A = {};\nconst B = {};\nconst C = {};\nconst D = {};\nproto(A, B);\nproto(C, D);\nproto(D, C);\n';
    const cycles = detectProtoCycles(parse(code));
    expect(cycles.length).toBe(1);
    expect(cycles[0].tails.length).toBe(0); // A→B never reaches C↔D
  });

  test('tails are empty when there is no cycle at all', () => {
    const cycles = detectProtoCycles(parse('const A = {};\nconst B = {};\nproto(A, B);\n'));
    expect(cycles.length).toBe(0);
  });
});
