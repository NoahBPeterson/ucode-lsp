const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');
const { typeToString, UcodeType, NEVER_TYPE, isNeverType } = require('../src/analysis/symbolTable');
const { joinTypes: engineJoin } = require('../src/analysis/flowTypeEngine');
const { TypeNarrowingEngine } = require('../src/analysis/typeNarrowing');

// docs/tc-falsy-branch-narrow-to-unknown.md + docs/tc-strict-equality-literal-narrowing.md
//
// Falsy edge of `if (v)`: per ucode's ucv_is_truish, false/null/0/0.0/NaN/"" are
// falsy, everything else truthy — so a scalar keeps its type on the falsy edge and
// only always-truthy objects/arrays collapse to BOTTOM. A truthiness guard used to
// flip to "keep only null" → empty → UNKNOWN (top), poisoning every post-if scalar
// read. And `x === "lit"` now narrows x on the true edge (strict equality is sound).

function analyze(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  return result.typeChecker;
}

/** Type displayed for the read `read(<varName>)` (last occurrence) in `code`. A
 *  null narrowing means "declared type applies" — we resolve it to the declared
 *  type so the assertion reflects what hover shows. */
function typeAtRead(code, varName, occurrence = 'last') {
  const tc = analyze(code);
  const marker = `read(${varName})`;
  const at = occurrence === 'last' ? code.lastIndexOf(marker) : code.indexOf(marker);
  const off = at + 'read('.length;
  const narrowed = tc.getNarrowedTypeAtPosition(varName, off);
  if (narrowed !== null) return typeToString(narrowed);
  // Fall back to the symbol's declared type (what hover would render).
  const sym = tc.symbolTable.lookup(varName) ?? tc.symbolTable.lookupAtPosition(varName, off);
  return sym ? typeToString(sym.dataType) : 'undefined';
}

// A trivial `read()` sink so the marker is a real call the analyzer accepts.
const PRELUDE = 'function read(x) { return x; }\n';

// ---------------------------------------------------------------------------
// Lattice primitives
// ---------------------------------------------------------------------------

test('BOTTOM is a distinct empty-union sentinel, NOT unknown', () => {
  expect(isNeverType(NEVER_TYPE)).toBe(true);
  expect(isNeverType(UcodeType.UNKNOWN)).toBe(false);
  expect(isNeverType(UcodeType.STRING)).toBe(false);
  expect(typeToString(NEVER_TYPE)).toBe('never');
});

test('joinTypes: BOTTOM is the identity (join(T, ⊥) = T), UNKNOWN is TOP', () => {
  expect(typeToString(engineJoin(UcodeType.OBJECT, NEVER_TYPE))).toBe('object');
  expect(typeToString(engineJoin(NEVER_TYPE, UcodeType.STRING))).toBe('string');
  // top still absorbs
  expect(typeToString(engineJoin(UcodeType.STRING, UcodeType.UNKNOWN))).toBe('unknown');
  // ⊥ wins even against unknown (identity precedes the top rule)
  expect(typeToString(engineJoin(NEVER_TYPE, UcodeType.UNKNOWN))).toBe('unknown');
});

test('narrowToFalsy: scalars keep their type, always-truthy → BOTTOM, unknown unchanged', () => {
  const n = new TypeNarrowingEngine();
  expect(typeToString(n.narrowToFalsy(UcodeType.BOOLEAN).narrowedType)).toBe('boolean');
  expect(typeToString(n.narrowToFalsy(UcodeType.INTEGER).narrowedType)).toBe('integer');
  expect(typeToString(n.narrowToFalsy(UcodeType.DOUBLE).narrowedType)).toBe('double');
  expect(typeToString(n.narrowToFalsy(UcodeType.STRING).narrowedType)).toBe('string');
  expect(typeToString(n.narrowToFalsy(UcodeType.NULL).narrowedType)).toBe('null');
  // object / array / function are ALWAYS truthy → impossible on the falsy edge
  expect(isNeverType(n.narrowToFalsy(UcodeType.OBJECT).narrowedType)).toBe(true);
  expect(isNeverType(n.narrowToFalsy(UcodeType.ARRAY).narrowedType)).toBe(true);
  expect(isNeverType(n.narrowToFalsy(UcodeType.FUNCTION).narrowedType)).toBe(true);
  // unknown carries no member info → unchanged
  expect(typeToString(n.narrowToFalsy(UcodeType.UNKNOWN).narrowedType)).toBe('unknown');
  // a nullable object: only null is falsy-capable
  const objOrNull = { type: UcodeType.UNION, types: [UcodeType.OBJECT, UcodeType.NULL] };
  expect(typeToString(n.narrowToFalsy(objOrNull).narrowedType)).toBe('null');
});

// ---------------------------------------------------------------------------
// Falsy-edge narrowing end-to-end (the BUG)
// ---------------------------------------------------------------------------

test('post-if read of a boolean stays boolean (was unknown)', () => {
  const code = PRELUDE + `function g() {
    let b = 1 > 0;
    if (b) print(1);
    read(b);
  }`;
  expect(typeAtRead(code, 'b')).toBe('boolean');
});

test('early-return-in-truthy-branch keeps the type after the if', () => {
  const code = PRELUDE + `function a1() {
    let h = 1 > 0;
    if (h) return;
    read(h);
  }`;
  expect(typeAtRead(code, 'h')).toBe('boolean');
});

test('else branch of a truthiness test keeps the scalar type', () => {
  const code = PRELUDE + `function a3() {
    let h = 1 > 0;
    if (h) { print(1); }
    else   { read(h); }
  }`;
  expect(typeAtRead(code, 'h')).toBe('boolean');
});

test('falsy-edge type per primitive: integer / string / double', () => {
  const iCode = PRELUDE + `function f() { let n = 3 + 4; if (n) print(1); read(n); }`;
  expect(typeAtRead(iCode, 'n')).toBe('integer');
  const sCode = PRELUDE + `function f() { let s = "" + "x"; if (s) print(1); read(s); }`;
  expect(typeAtRead(sCode, 's')).toBe('string');
  const dCode = PRELUDE + `function f() { let d = 1.5; if (d) print(1); read(d); }`;
  expect(typeAtRead(dCode, 'd')).toBe('double');
});

test('always-truthy object falsy edge does NOT poison a sibling variable at the merge', () => {
  const code = PRELUDE + `function poison() {
    let obj = { a: 1 };
    let s = "hi";
    if (obj) { s = "yo"; }
    read(s);
  }`;
  // obj's falsy edge is BOTTOM; the join identity keeps s = string (not unknown).
  expect(typeAtRead(code, 's')).toBe('string');
});

test('an always-truthy object read on the (impossible) falsy path shows its declared type, not never', () => {
  const code = PRELUDE + `function earlyret() {
    let o = { x: 1 };
    if (o) return;
    read(o);
  }`;
  expect(typeAtRead(code, 'o')).toBe('object');
});

test('nested if/else merges do not poison', () => {
  const code = PRELUDE + `function nested() {
    let b = 1 > 0;
    let n = 5;
    if (b) {
      if (n) { print(1); }
    } else {
      print(2);
    }
    read(b);
    read(n);
  }`;
  expect(typeAtRead(code, 'b')).toBe('boolean');
  expect(typeAtRead(code, 'n')).toBe('integer');
});

// ---------------------------------------------------------------------------
// Preserve existing null-guard behavior (must NOT regress)
// ---------------------------------------------------------------------------

test('truthy branch of `if (x)` still removes null from a nullable union', () => {
  const code = PRELUDE + `function f() {
    let s = "" + "x";
    let v = s ? s : null;
    if (v) { read(v); }
  }`;
  // v: string|null; inside the truthy branch, null is removed.
  expect(typeAtRead(code, 'v')).toBe('string');
});

// ---------------------------------------------------------------------------
// Strict-equality literal narrowing (Fix 2)
// ---------------------------------------------------------------------------

test('`x === "lit"` narrows x to string on the true edge', () => {
  const code = PRELUDE + `function f(x) {
    if (x === "bar") { read(x); }
  }`;
  expect(typeAtRead(code, 'x')).toBe('string');
});

test('`x === 5` narrows x to integer; `x === true` to boolean', () => {
  const iCode = PRELUDE + `function f(x) { if (x === 5) { read(x); } }`;
  expect(typeAtRead(iCode, 'x')).toBe('integer');
  const bCode = PRELUDE + `function f(x) { if (x === true) { read(x); } }`;
  expect(typeAtRead(bCode, 'x')).toBe('boolean');
});

test('`<lit> === x` (reversed operands) narrows too', () => {
  const code = PRELUDE + `function f(x) { if ("phy" === x) { read(x); } }`;
  expect(typeAtRead(code, 'x')).toBe('string');
});

test('`x !== 5` narrows x to integer in the ELSE branch (false edge)', () => {
  const code = PRELUDE + `function f(x) {
    if (x !== 5) { print(1); } else { read(x); }
  }`;
  expect(typeAtRead(code, 'x')).toBe('integer');
});

test('`==` (coercing) does NOT narrow — 1 == "1" is true, so a match proves nothing', () => {
  const code = PRELUDE + `function f(x) {
    if (x == "baz") { read(x); }
  }`;
  // Must stay unknown: `==` coerces, so this is not a sound type guard.
  expect(typeAtRead(code, 'x')).toBe('unknown');
});
