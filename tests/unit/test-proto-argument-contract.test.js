// Exhaustive argument-contract tests for proto(): every UcodeType in every
// position, driven by Effect Match so a NEW UcodeType fails the suite until it
// is covered here.
//
// Ground truth — lib.c uc_proto + types.c ucv_prototype_set/ucv_prototype_get,
// each confirmed against the interpreter 2026-08-21:
//
//   1 arg  -> ucv_prototype_get(val): tolerates ANY value. Never throws.
//             Returns null for anything with no prototype; a RESOURCE reports
//             its resource TYPE's shared prototype (how fs.file methods work).
//   2 args -> ucv_prototype_set(val, proto), which succeeds ONLY when the
//             target is UC_ARRAY|UC_OBJECT *and* the prototype is UC_OBJECT.
//             On failure uc_proto RAISES "Passed value is neither a prototype,
//             resource or object" — so proto({}, null), proto({}, [1,2]),
//             proto({}, 5), proto(5, {}), proto("str", {}) and
//             proto(<fs.file>, {}) all throw. Verified live, every one.
//
// Three possible verdicts per case:
//   'clean'     — accepted
//   'mismatch'  — a provably wrong type: "expects …"/"Argument N …" mismatch
//   'unknown'   — unverifiable operand: the standard unknown-argument nag that
//                 every builtin gives (ANY must behave EXACTLY like UNKNOWN)
//   'null-proto'— the dedicated message: null is not a detach form
import { test, expect, describe } from 'bun:test';
import { Match } from 'effect';
import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { UcodeType } from '../../src/analysis/symbolTable.ts';

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  const parseResult = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => {
      let l = 0, c = 0;
      for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } }
      return { line: l, character: c };
    },
    offsetAt: (p) => {
      const lines = code.split('\n');
      let o = 0;
      for (let i = 0; i < p.line && i < lines.length; i++) o += lines[i].length + 1;
      return o + p.character;
    },
    uri: 'file:///proto-contract.uc', languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
  return analyzer.analyze(parseResult.ast);
}

/** Only proto()-related diagnostics, so unrelated lints (unused vars, missing
 *  @param hints) can never make a case look like a contract violation. */
const protoDiags = (code) => (analyze(code).diagnostics || []).filter(d => /proto\(\)|'proto'/.test(d.message));

/** A program binding `v` to the given UcodeType, then running `call`.
 *  UNKNOWN needs an unannotated PARAMETER — an uninitialized `let v;` reads
 *  back as null in ucode, so it is NULL, not unknown. Exhaustive by Match. */
const programForType = (t, call) => {
  const wrapParam = (c) => `function probe(v) {\n\t${c}\n}\nprint(probe);\n`;
  const withBinding = (b) => `${b}\n${call}\n`;
  return Match.value(t).pipe(
    Match.when(UcodeType.INTEGER,  () => withBinding('let v = 42;')),
    Match.when(UcodeType.DOUBLE,   () => withBinding('let v = 3.14;')),
    Match.when(UcodeType.STRING,   () => withBinding('let v = "hello";')),
    Match.when(UcodeType.BOOLEAN,  () => withBinding('let v = true;')),
    Match.when(UcodeType.ARRAY,    () => withBinding('let v = [1, 2];')),
    Match.when(UcodeType.OBJECT,   () => withBinding('let v = { x: 1 };')),
    Match.when(UcodeType.FUNCTION, () => withBinding('let v = function() { return 1; };')),
    Match.when(UcodeType.REGEX,    () => withBinding('let v = /test/;')),
    Match.when(UcodeType.NULL,     () => withBinding('let v = null;')),
    Match.when(UcodeType.UNKNOWN,  () => wrapParam(call)),
    Match.when(UcodeType.ANY,      () => withBinding('let v = json("{}");')), // json()'s reflective return
    Match.when(UcodeType.UNION,    () => null), // not a concrete binding
    Match.exhaustive,
  );
};

const CONCRETE = Object.values(UcodeType).filter(t => t !== UcodeType.UNION);
const UNVERIFIABLE = new Set([UcodeType.UNKNOWN, UcodeType.ANY]);

function assertVerdict(diags, verdict) {
  switch (verdict) {
    case 'clean':
      expect(diags.map(d => d.message)).toEqual([]);
      break;
    case 'unknown':
      expect(diags.length).toBe(1);
      expect(diags[0].message).toMatch(/is unknown/);
      break;
    case 'null-proto':
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some(d => /cannot take null as a prototype/.test(d.message))).toBe(true);
      break;
    case 'mismatch':
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.some(d => /expects |[Aa]rgument \d/.test(d.message))).toBe(true);
      break;
    default:
      throw new Error('unhandled verdict: ' + verdict);
  }
}

// ── Position 1: the TARGET — only arrays and objects can carry a prototype ──
describe('proto(<T>, {…}) — target must be an array or object', () => {
  for (const ucType of CONCRETE) {
    const code = programForType(ucType, 'proto(v, { m: 1 });');
    if (code === null) continue;
    const verdict = UNVERIFIABLE.has(ucType) ? 'unknown'
      : (ucType === UcodeType.ARRAY || ucType === UcodeType.OBJECT) ? 'clean'
      : 'mismatch';
    test(`target ${ucType} → ${verdict}`, () => { assertVerdict(protoDiags(code), verdict); });
  }
});

// ── Position 2: the PROTOTYPE — must be an object; null is NOT a detach ──
describe('proto({…}, <T>) — prototype must be an object', () => {
  for (const ucType of CONCRETE) {
    const code = programForType(ucType, 'let target = { own: 1 };\n\tproto(target, v);');
    if (code === null) continue;
    const verdict = UNVERIFIABLE.has(ucType) ? 'unknown'
      : ucType === UcodeType.OBJECT ? 'clean'
      : ucType === UcodeType.NULL ? 'null-proto'
      : 'mismatch';
    test(`prototype ${ucType} → ${verdict}`, () => { assertVerdict(protoDiags(code), verdict); });
  }
});

// ── The 1-argument READ form tolerates every value and never throws ──
describe('proto(<T>) — the read form accepts anything', () => {
  for (const ucType of CONCRETE) {
    const code = programForType(ucType, 'print(proto(v));');
    if (code === null) continue;
    test(`read ${ucType} → clean`, () => { expect(protoDiags(code).map(d => d.message)).toEqual([]); });
  }
});

// ── Cross-checks the per-type loops cannot express ──
describe('contract invariants', () => {
  test('ANY behaves EXACTLY like UNKNOWN in both positions (its documented contract)', () => {
    for (const call of ['proto(v, { m: 1 });', 'let target = { own: 1 };\n\tproto(target, v);']) {
      const anyDiags = protoDiags(programForType(UcodeType.ANY, call)).map(d => d.message);
      const unkDiags = protoDiags(programForType(UcodeType.UNKNOWN, call)).map(d => d.message);
      expect(anyDiags).toEqual(unkDiags);
    }
  });

  test('a union containing null stays silent — `proto(ret, proto(this))` is the OpenWrt idiom', () => {
    const code = 'const P = {\n\tf: function() {\n\t\tlet ret = {};\n\t\treturn proto(ret, proto(this));\n\t},\n};\nlet i = proto({ x: 1 }, P);\nprint(i.f());\n';
    expect(protoDiags(code).map(d => d.message)).toEqual([]);
  });

  test('both operands wrong reports the target, not just one diagnostic total', () => {
    const diags = protoDiags('proto("str", 5);\n');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some(d => /argument 1/i.test(d.message))).toBe(true);
  });

  test('zero arguments is an arity error, not a type error', () => {
    const diags = protoDiags('proto();\n');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some(d => /argument/i.test(d.message))).toBe(true);
  });
});

// ── C resource handles: legal to READ from, never legal to attach ──
// Provenance: every name in RESOURCE_BACKED_OBJECT_TYPES is declared with
// uc_type_declare() in ucode/lib/*.c or an OpenWrt package. Spot-checked live
// (owrt-main 2026-08-21): fs.file/fs.dir/fs.proc/uloop.timer/uci.cursor report
// type()=="resource" and throw on attach — in EITHER position — while
// fs.stat/fs.statvfs/exception report "object" and attach fine.
describe('resource handles cannot carry (or be) a prototype', () => {
  const handleCases = [
    ['fs.file',    'import { open } from "fs";\nlet h = open("/e", "r");\nif (h) {\n\tCALL\n}\nprint(h);\n'],
    ['uci.cursor', 'import * as uci from "uci";\nlet h = uci.cursor();\nCALL\nprint(h);\n'],
  ];

  for (const [name, tmpl] of handleCases) {
    test(`${name} as TARGET → flagged, and only once (no null pile-on)`, () => {
      const diags = protoDiags(tmpl.replace('CALL', 'proto(h, { m: 1 });'));
      expect(diags.length).toBe(1);
      expect(diags[0].message).toMatch(/cannot attach a prototype to a .* handle/);
    });

    test(`${name} as PROTOTYPE → flagged`, () => {
      const diags = protoDiags(tmpl.replace('CALL', 'let t = { own: 1 };\n\tproto(t, h);'));
      expect(diags.length).toBe(1);
      expect(diags[0].message).toMatch(/cannot use a .* handle as a prototype/);
    });

    test(`${name} through the 1-arg READ form → clean (ucv_prototype_get handles resources)`, () => {
      expect(protoDiags(tmpl.replace('CALL', 'print(proto(h));')).map(d => d.message)).toEqual([]);
    });
  }

  test('a plain DICT from the same registry (fs.stat) attaches fine', () => {
    const code = 'import { stat } from "fs";\nlet st = stat("/e");\nif (st) {\n\tproto(st, { m: 1 });\n}\nprint(st);\n';
    expect(protoDiags(code).map(d => d.message)).toEqual([]);
  });

  test('the exception object is a plain dict too — attaches fine', () => {
    const code = 'try {\n\tdie("x");\n}\ncatch (e) {\n\tproto(e, { m: 1 });\n\tprint(e);\n}\n';
    expect(protoDiags(code).map(d => d.message)).toEqual([]);
  });
});
