// Phase 4b typing: an injected render-scope name takes the TYPE of its scope value at the
// include site (e.g. `include("c.uc", { direction: "input" })` ⇒ `direction` is a string in
// c.uc). Each value kind is checked for oracle parity: ucode's runtime `type(name)` must match
// the type we infer. Skips automatically if the locally-built oracle (ucode/utpl) is absent.

import { test, expect, describe } from 'bun:test';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../src/lexer/index.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { buildIncludeScopeIndex } from '../src/analysis/includeScope.ts';

const UTPL = resolve('ucode/utpl');
const LIBDIR = resolve('ucode');
const oracleAvailable = existsSync(UTPL);
const d = oracleAvailable ? describe : describe.skip;

function oracleType(scopeValueLiteral) {
  // child prints type(x) for the single injected value `x`
  const dir = mkdtempSync(join(tmpdir(), 'uc4bt-'));
  writeFileSync(join(dir, 'p.uc'), `{% include("c.uc", { x: ${scopeValueLiteral} }); %}`);
  writeFileSync(join(dir, 'c.uc'), "{% 'use strict'; printf('%s', type(x)); %}");
  try {
    return execFileSync(UTPL, [join(dir, 'p.uc')], { env: { ...process.env, DYLD_LIBRARY_PATH: LIBDIR, LD_LIBRARY_PATH: LIBDIR }, encoding: 'utf8' });
  } catch (e) { return `ERR:${e.stderr || e.message}`; }
}

const parse = (src) => {
  const isT = detectTemplateMode(src);
  const toks = new UcodeLexer(src, { rawMode: !isT }).tokenize();
  return new UcodeParser(isT ? bridgeTemplateTokens(toks) : toks, src).parse().ast;
};
function ourInjectedType(scopeValueLiteral) {
  const idx = buildIncludeScopeIndex([{ path: '/w/p.uc', ast: parse(`{% include("c.uc", { x: ${scopeValueLiteral} }); %}`) }]);
  return idx.get('/w/c.uc').injectedTypes.get('x');
}

// our inferred type name → ucode's runtime type() name
const TO_ORACLE = { string: 'string', integer: 'int', double: 'double', boolean: 'bool', object: 'object', array: 'array', function: 'function' };

d('typing parity with ucode type() per scope-value kind', () => {
  const cases = [
    ['string literal', '"hello"', 'string'],
    ['integer literal', '42', 'integer'],
    ['double literal', '1.5', 'double'],
    ['boolean literal', 'true', 'boolean'],
    ['object literal', '{ a: 1 }', 'object'],
    ['array literal', '[ 1, 2 ]', 'array'],
    ['arrow function', '() => 1', 'function'],
  ];
  for (const [label, literal, ourType] of cases) {
    test(`${label} → ${ourType} (matches oracle type())`, () => {
      expect(ourInjectedType(literal)).toBe(ourType);
      expect(oracleType(literal)).toBe(TO_ORACLE[ourType]);
    });
  }

  test('null literal → null (oracle type(null) is null, not a string)', () => {
    expect(ourInjectedType('null')).toBe('null');
    expect(oracleType('null')).toBe('(null)'); // printf %s of a null value
  });
});

d('typing: identifier, require, and conflicts', () => {
  test('a require("fs") scope value injects the fs module type', () => {
    const idx = buildIncludeScopeIndex(
      [{ path: '/w/p.uc', ast: parse('{% include("c.uc", { handle: require("fs") }); %}') }],
      { resolveRequireType: (m) => (m === 'fs' ? 'fs' : null) },
    );
    expect(idx.get('/w/c.uc').injectedTypes.get('handle')).toBe('fs');
  });

  test('a require of a user module stays untyped', () => {
    const idx = buildIncludeScopeIndex(
      [{ path: '/w/p.uc', ast: parse('{% include("c.uc", { fw4: require("fw4") }); %}') }],
      { resolveRequireType: () => null },
    );
    expect(idx.get('/w/c.uc').injectedTypes.has('fw4')).toBe(false);
  });

  test('an identifier value resolves transitively to the includer’s injected type', () => {
    // grand injects v:string; parent forwards it via shorthand { v } → child gets v:string
    const idx = buildIncludeScopeIndex([
      { path: '/w/grand.uc', ast: parse('{% include("parent.uc", { v: "s" }); %}') },
      { path: '/w/parent.uc', ast: parse('{% include("child.uc", { v }); %}') },
    ]);
    expect(idx.get('/w/child.uc').injectedTypes.get('v')).toBe('string');
  });

  test('conflicting concrete types across includers → untyped (unknown)', () => {
    const idx = buildIncludeScopeIndex([
      { path: '/w/a.uc', ast: parse('{% include("c.uc", { x: "s" }); %}') },
      { path: '/w/b.uc', ast: parse('{% include("c.uc", { x: 42 }); %}') },
    ]);
    expect(idx.get('/w/c.uc').injectedTypes.has('x')).toBe(false);
    expect([...idx.get('/w/c.uc').injectedNames]).toEqual(['x']); // still suppressed
  });

  test('agreeing types across includers stay typed', () => {
    const idx = buildIncludeScopeIndex([
      { path: '/w/a.uc', ast: parse('{% include("c.uc", { x: "s1" }); %}') },
      { path: '/w/b.uc', ast: parse('{% include("c.uc", { x: "s2" }); %}') },
    ]);
    expect(idx.get('/w/c.uc').injectedTypes.get('x')).toBe('string');
  });
});

describe('typing is applied during analysis', () => {
  function analyzeChildWithInjected(childSrc, names, types) {
    const doc = { getText: () => childSrc, positionAt: (o) => ({ line: 0, character: o }), offsetAt: (p) => p.character, uri: 'file:///c.uc', languageId: 'ucode', version: 1 };
    const an = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
    an.setInjectedScope(new Set(names), new Map(Object.entries(types)));
    return an.analyze(parse(childSrc)).diagnostics;
  }

  test('a string-typed injected name is seen as a string by uniq() — proves the type is used', () => {
    // uniq expects array. With x typed string we get the definite "got string" message;
    // with x unknown we get the generic "is unknown" message instead. The difference proves
    // the injected type reached the checker.
    const withType = analyzeChildWithInjected('{% uniq(x); %}', ['x'], { x: 'string' });
    const asUnknown = analyzeChildWithInjected('{% uniq(x); %}', ['x'], {});
    expect(withType.some((dg) => /got string/.test(dg.message))).toBe(true);
    expect(asUnknown.some((dg) => /got string/.test(dg.message))).toBe(false);
  });

  test('an untyped injected name still suppresses UC1001', () => {
    const diags = analyzeChildWithInjected('{{ x }}', ['x'], {});
    expect(diags.filter((dg) => dg.severity === 1 && /Undefined/.test(dg.message))).toEqual([]);
  });
});
