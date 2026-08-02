// The flow-analysis false-positive trio filed from ucode's own run_tests.uc FP sweep:
//   1. docs/tc-loop-carried-flow-join.md            — loop back-edge join for reads in a loop body
//   2. docs/tc-assignment-expression-guard-narrowing — `(m = match(...)) != null` narrows m
//   3. docs/tc-nullish-die-narrowing.md             — `x ?? die()` / `x || die()` drop null
//
// The engine now seeds the loop head as the JOIN of (entry, end-of-body) and iterates to a
// (widened) fixpoint, so a variable assigned on a PREVIOUS iteration is no longer read as
// "definitely null" — a definite-null claim (UC5005 error / UC2009 "always false") is downgraded
// to a may-null UC5006 warning or suppressed. die()/exit() are typed NEVER (bottom), so the
// "open or die" idiom narrows null away.
const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer');
const { typeToString, isNeverType, NEVER_TYPE } = require('../src/analysis/symbolTable');

function analyze(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  return new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
}
const diagsOf = (code) => analyze(code).diagnostics;
const hasCode = (code, c) => diagsOf(code).some((d) => d.code === c);
/** getNarrowedTypeAtPosition for `name` at the FIRST occurrence of `marker`. */
function narrowedAt(code, name, marker) {
  const r = analyze(code);
  const nt = r.typeChecker.getNarrowedTypeAtPosition(name, code.indexOf(marker));
  return nt === null ? null : typeToString(nt);
}
function symType(code, name) {
  const r = analyze(code);
  const off = code.lastIndexOf(name);
  const s = r.typeChecker.symbolTable.lookupAtPosition(name, off) ?? r.typeChecker.symbolTable.lookupOpenScopes(name);
  return s ? typeToString(s.dataType) : null;
}

// ── Ticket 1: loop-carried flow join ────────────────────────────────────────
// The section header/tuple pattern from run_tests.uc, reduced. `section` is assigned a tuple
// on a header branch and read in a LATER branch on a subsequent iteration.
const LOOP = `function f(fp) {
  let section, m;
  for (let line = fp.read('line'); length(line); line = fp.read('line')) {
    if (line == 'a')                              section = [ 'args', [] ];
    else if (line == 'b')                         section = [ 'code', '' ];
    else if ((m = match(line, /^end$/)) != null) {
      if (m[1] != null && type(section[-1]) == 'string')
        section[-1] = 'x';
      if (section[0] == 'code')                   print(section[1]);
      section = null;
    }
    else if (section)                             print(section[0]);
  }
}`;

test('loop-carried tuple state: no definite-null UC5005 error on a later-branch read', () => {
  expect(hasCode(LOOP, 'UC5005')).toBe(false);
});

test('loop-carried tuple state: no "always false" UC2009 on `section[0] == "code"`', () => {
  expect(hasCode(LOOP, 'UC2009')).toBe(false);
});

test('first-iteration genuine null stays warnable — at most a UC5006 may-null warning', () => {
  // `section` really can be null on iteration 1 (the loop hits `-- end --` first), so a soft
  // may-null warning is the correct verdict: never a hard error, may be a UC5006.
  const d = diagsOf(LOOP);
  expect(d.some((x) => x.code === 'UC5005')).toBe(false);
  const maybeWarn = d.filter((x) => x.code === 'UC5006');
  // Every retained section diagnostic is a WARNING (severity 2), never an error.
  for (const w of maybeWarn) expect(w.severity).toBe(2);
});

test('loop-carried join engine base is may-null (array + null), not provably-null', () => {
  const t = narrowedAt(LOOP, 'section', 'section[0] == ');
  expect(t).not.toBeNull();
  expect(t).toContain('array');   // a tuple reached this read
  expect(t).toContain('null');    // …but null is still possible (iteration 1)
});

// ── Ticket 2: assignment-expression guard narrowing (all four forms) ─────────
const G_NEQ = `function g(s){ let m; if ((m = match(s, /(x)/)) != null) return m[1]; }`;
const G_TRU = `function g(s){ let m; if ((m = match(s, /(x)/))) return m[1]; }`;
const G_WHL = `function g(s){ let m; while ((m = match(s, /(x)/)) != null) print(m[1]); }`;
const G_EQ  = `function g(s){ let m; if ((m = match(s, /(x)/)) == null) return; return m[1]; }`;

for (const [name, code] of [['(m=f()) != null', G_NEQ], ['if ((m=f()))', G_TRU],
                            ['while ((m=f()) != null)', G_WHL], ['(m=f()) == null; else', G_EQ]]) {
  test(`assignment-in-condition narrows m to non-null array — ${name}`, () => {
    const t = narrowedAt(code, 'm', 'm[1]');
    expect(t).not.toBeNull();
    expect(t).toContain('array');
    expect(t).not.toContain('null');
    expect(hasCode(code, 'UC5005')).toBe(false);
  });
}

test('assign-and-test does NOT leak a stale null-guard past a reassignment in a sibling else-if', () => {
  // Reaching the 2nd else-if means the 1st `(m = match) != null` was false (m == null) — but the
  // 2nd else-if REASSIGNS m in its own condition, so m is string|null (not null) at split().
  const code = `function f(line){ let m;
    if ((m = match(line, /a/)) != null) print(m[1]);
    else if ((m = trim(line)) != '') print(split(m, /b/)); }`;
  const t = narrowedAt(code, 'm', 'split(m');
  expect(t).not.toBe('null');
  expect(hasCode(code, 'UC2004')).toBe(false); // no "got null" definite-null arg error
});

// ── Ticket 3: `?? die()` / `|| die()` narrowing + die/exit NEVER ─────────────
const OPEN = `import { open } from "fs";\n`;

test('`x ?? die(...)` narrows away null (declaration form)', () => {
  const code = OPEN + `function h(){ let fp = open("x", "r") ?? die("no"); return fp.read("line"); }`;
  expect(symType(code, 'fp')).toBe('fs.file');
  expect(diagsOf(code).some((d) => /null/.test(d.message))).toBe(false);
});

test('`x || die(...)` narrows away null (truthy-fallback form)', () => {
  const code = OPEN + `function h(){ let fp = open("x") || die("no"); return fp.read(); }`;
  expect(symType(code, 'fp')).toBe('fs.file');
  expect(diagsOf(code).some((d) => /null/.test(d.message))).toBe(false);
});

test('`exit()` is a NEVER terminator too — `x ?? exit(1)` drops null', () => {
  const code = OPEN + `function h(){ let fp = open("x") ?? exit(1); return fp.read(); }`;
  expect(symType(code, 'fp')).toBe('fs.file');
  expect(diagsOf(code).some((d) => /null/.test(d.message))).toBe(false);
});

test('`expr ?? die(...)` as an expression statement does not warn', () => {
  const code = OPEN + `import { writefile } from "fs";\nwritefile("x", "y") ?? die("no");`;
  expect(diagsOf(code).some((d) => /null/.test(d.message))).toBe(false);
});

test('`unknown ?? die()` stays unknown (no narrower representation)', () => {
  const code = `function h(x){ let y = x ?? die("no"); return y; }`;
  expect(symType(code, 'y')).toBe('unknown');
});

test('die()/exit() are typed NEVER (bottom) — a `let x = die()` symbol is never', () => {
  expect(symType(`function n(){ let z = die(); return z; }`, 'z')).toBe('never');
  expect(symType(`function n(){ let z = exit(1); return z; }`, 'z')).toBe('never');
});

test('NEVER never leaks through getNarrowedTypeAtPosition (hover guard)', () => {
  const code = `function n(){ let z = die(); return z; }`;
  const r = analyze(code);
  const nt = r.typeChecker.getNarrowedTypeAtPosition('z', code.lastIndexOf('z'));
  // The narrowing path returns null (no refinement) for a never result — it must NOT
  // surface `never` for hover to render.
  expect(nt === null || !isNeverType(nt)).toBe(true);
});

test('NEVER_TYPE is the empty-union bottom sentinel', () => {
  expect(isNeverType(NEVER_TYPE)).toBe(true);
  expect(typeToString(NEVER_TYPE)).toBe('never');
});
