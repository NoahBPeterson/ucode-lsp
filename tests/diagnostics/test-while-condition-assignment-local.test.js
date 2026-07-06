// A local assigned inside a `while (...)` (or any) condition must resolve to that local, not be
// mistaken for an implicit global. Regression: `let chunk; while ((chunk = read()) && …)` tripped
// a false UC8004 "Global 'chunk' is assigned only inside function". The implicit-global collector
// is now scope-aware: a bare `x = …` is a global only when `x` is declared in NO enclosing scope.
// (docs/while-condition-assignment-narrowing.md, Finding #1)
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const diags = async (code) => (await s.getDiagnostics(code, `/tmp/wca-${n++}.uc`)) || [];
const uc8004 = async (code) => (await diags(code)).filter((d) => d.code === 'UC8004').length;

test('a local assigned in a while-condition is not a false UC8004', async () => {
  expect(await uc8004("function f() {\n  let chunk;\n  while ((chunk = 1)) { print(chunk); }\n}\n")).toBe(0);
});

test('multi-declarator `let ok = true, chunk;` — the trailing local is fine', async () => {
  expect(await uc8004("function f() {\n  let ok = true, chunk;\n  while ((chunk = 1)) { ok = chunk; }\n  return ok;\n}\n")).toBe(0);
});

test('the read idiom `(chunk = read()) && length(chunk)` in a while is clean', async () => {
  const code = "import { open } from 'fs';\n" +
    "function mv(src) {\n" +
    "  let src_f = open(src, 'r');\n" +
    "  if (!src_f) return false;\n" +
    "  let ok = true, chunk;\n" +
    "  while ((chunk = src_f.read(65536)) && length(chunk)) { ok = false; }\n" +
    "  return ok;\n" +
    "}\n";
  expect(await uc8004(code)).toBe(0);
});

test('a param assigned in a condition is a local, not a global', async () => {
  expect(await uc8004("function f(x) {\n  while ((x = x - 1) > 0) { print(x); }\n}\n")).toBe(0);
});

// ── declared in nested constructs (switch case / try-catch / block) ──────────
test('a local declared in a SWITCH CASE, reassigned in a while-condition, is not UC8004 (fw4)', async () => {
  // The exact fw4 resolve_lower_devices pattern.
  const code = "import * as fs from 'fs';\n" +
    "function f(devstatus, devname) {\n" +
    "  let dir = fs.opendir('/x');\n" +
    "  if (dir) {\n" +
    "    switch (devstatus[devname]?.devtype) {\n" +
    "    case 'vlan':\n" +
    "    case 'bridge':\n" +
    "      let e;\n" +
    "      while ((e = dir.read()) != null) print(e);\n" +
    "    }\n" +
    "  }\n" +
    "}\n";
  expect(await uc8004(code)).toBe(0);
});

test('a catch param reassigned in the handler is a local, not a global', async () => {
  expect(await uc8004("function f() {\n  try { die('x'); } catch (err) { err = 2; print(err); }\n}\n")).toBe(0);
});

test('a local declared in a nested block, reassigned in that block, is not UC8004', async () => {
  expect(await uc8004("function f() {\n  if (1) { let x; while ((x = 1)) print(x); }\n}\n")).toBe(0);
});

// ── soundness: genuine implicit globals are STILL flagged ─────────────────────
test('SOUND: a bare `x = …` in a function where x is NOT declared still flags UC8004', async () => {
  // x is a real implicit global assigned only inside g() → existence uncertain.
  expect(await uc8004("function g() { x = 2; }\nprint(x);\n")).toBeGreaterThanOrEqual(1);
});

test('SOUND: shadowing — `let x` in one fn does NOT excuse a bare `x =` in another', async () => {
  // A has its own local x; B's bare `x = 2` is still a global write only inside B.
  expect(await uc8004("function A() { let x = 1; return x; }\nfunction B() { x = 2; }\nprint(x);\n")).toBeGreaterThanOrEqual(1);
});

// ── Finding #2: `(x = read()) && length(x)` narrows the assigned target (strict-mode) ─────────
// The `&&` short-circuits, so `length(chunk)` runs only when `(chunk = read())` is truthy — chunk
// is a non-empty string there, never null. This held for a plain `chunk && …` but NOT for the
// assignment idiom `(chunk = read()) && …`, and only surfaced under `'use strict'` (the length()
// nullable-argument diagnostic is strict-gated). (docs/while-condition-assignment-narrowing.md #2)
const nullableLen = async (code) =>
  (await diags(code)).filter((d) => d.code === 'nullable-argument' && /length/.test(d.message || '')).length;

const STRICT = "'use strict';\nimport { open } from 'fs';\n";

test('strict: the exact move_file idiom narrows chunk — no false "length may be null"', async () => {
  const code = STRICT +
    "function mv(src, dst) {\n" +
    "  let s = open(src, 'r'); if (!s) return false;\n" +
    "  let d2 = open(dst, 'w'); if (!d2) { s.close(); return false; }\n" +
    "  let ok = true, chunk;\n" +
    "  while ((chunk = s.read(65536)) && length(chunk)) { d2.write(chunk); }\n" +
    "  s.close(); d2.close(); return ok;\n" +
    "}\n";
  expect(await nullableLen(code)).toBe(0);
});

test('strict: assignment-target && narrowing works in if- and value-context too', async () => {
  const ifCtx = STRICT + "function f(s){ let h=open(s,'r'); if(!h) return; let c; if((c=h.read(9)) && length(c)) print(c); }";
  const valCtx = STRICT + "function f(s){ let h=open(s,'r'); if(!h) return; let c; let x=(c=h.read(9)) && length(c); }";
  expect(await nullableLen(ifCtx)).toBe(0);
  expect(await nullableLen(valCtx)).toBe(0);
});

test('SOUND: an unguarded nullable arg still fires; `||` and other vars are NOT narrowed', async () => {
  // no guard at all → fires
  expect(await nullableLen(STRICT + "function f(s){ let h=open(s,'r'); if(!h) return; let c=h.read(9); let n=length(c); }")).toBeGreaterThanOrEqual(1);
  // `||` RHS runs when the assignment is FALSY → c may be null → must still fire
  expect(await nullableLen(STRICT + "function f(s){ let h=open(s,'r'); if(!h) return; let c; let x=(c=h.read(9)) || length(c); }")).toBeGreaterThanOrEqual(1);
  // narrows the assigned target `c`, not a different variable `o`
  expect(await nullableLen(STRICT + "function f(s){ let h=open(s,'r'); if(!h) return; let c,o=h.read(9); let x=(c=h.read(9)) && length(o); }")).toBeGreaterThanOrEqual(1);
});
