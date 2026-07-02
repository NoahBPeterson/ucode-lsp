// UC8004: a global whose existence at a later read cannot be statically determined — every
// assignment sits in a spot that may not execute (function body, if/else branch, switch case,
// loop, try/catch, ternary arm, short-circuit RHS). Precision (must-assign) keeps it honest:
// exhaustive if/else + switch-with-default + try/catch-both-sides, `if (true)` guards, and
// unconditional top-level calls (tier-1-lite call graph) are all statically determinable →
// silent. `@global`-declared names are exempt (sanctioned opt-out).
import { test, expect } from "bun:test";
import path from "path";
import { SemanticAnalyzer } from "../../src/analysis/semanticAnalyzer";
import { UcodeLexer } from "../../src/lexer/ucodeLexer";
import { UcodeParser } from "../../src/parser/ucodeParser";
import { FileResolver } from "../../src/analysis/fileResolver";
import { TextDocument } from "vscode-languageserver-textdocument";

const FIX = path.resolve(import.meta.dir, "..", "fixtures", "scopeorder");
function analyze(code, opt = {}) {
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = TextDocument.create("file://" + path.join(FIX, "a.uc"), "ucode", 1, code);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, uncertainGlobalScope: 'errorInStrict', ...opt }, new FileResolver(FIX)).analyze(ast);
}
const u4 = (code, opt) => analyze(code, opt).diagnostics.filter(d => d.code === 'UC8004');

// ── still flagged: genuinely non-deterministic ─────────────────────────────────────────────

test("global defined only inside an uncalled function → flagged, with the new message", () => {
  const d = u4("function init() { global.CFG = {}; }\n");
  expect(d.length).toBe(1);
  expect(/inside function 'init'/.test(d[0].message)).toBe(true);
  expect(/cannot be statically determined/.test(d[0].message)).toBe(true);
  expect(/global\.CFG = null;/.test(d[0].message)).toBe(true);   // concrete seed-default fix
  expect(/@global CFG/.test(d[0].message)).toBe(true);           // sanctioned escape named
  expect(d[0].data?.globalName).toBe("CFG");                     // quick-fix payload
});

test("if WITHOUT else → flagged", () => {
  expect(u4("if (getenv('X')) { global.MODE = 1; }\n").length).toBe(1);
});

test("if/else where only ONE arm assigns → flagged", () => {
  expect(u4("if (c) { global.M = 1; } else { print(1); }\n").length).toBe(1);
});

test("different globals in different if/else-if/else branches → each flagged", () => {
  expect(u4("if (a) { global.A = 1; } else if (b) { global.B = 2; } else { global.C = 3; }\n").length).toBe(3);
});

test("switch WITHOUT default → flagged even if every case assigns", () => {
  expect(u4("switch (t) {\ncase 1: global.K = 1; break;\ncase 2: global.K = 2; break;\n}\n").length).toBe(2);
});

test("switch WITH default but one entry misses the global → flagged", () => {
  const d = u4("switch (t) {\ncase 1: global.K = 1; break;\ndefault: global.J = 2;\n}\n");
  expect(d.length).toBe(2); // K missing on the default path, J missing on the case-1 path
});

test("loop bodies (may run zero times) → flagged", () => {
  expect(u4("for (let i = 0; i < 3; i++) { global.SEEN = i; }\n").length).toBe(1);
  expect(u4("while (more()) { global.LAST = 1; }\n").length).toBe(1);
});

test("try assigns but catch doesn't → flagged", () => {
  expect(u4("try { global.H = json('{}'); } catch (e) { print(e); }\n").length).toBe(1);
});

test("ternary arms assigning DIFFERENT globals → both flagged", () => {
  expect(u4("cond ? (global.A = 1) : (global.B = 2);\n").length).toBe(2);
});

test("short-circuit RHS → flagged", () => {
  expect(u4("ok && (global.READY = 1);\n").length).toBe(1);
});

test("CONDITIONAL call to the defining function → still flagged", () => {
  expect(u4("function boot() { global.CFG = {}; }\nif (c) boot();\n").length).toBe(1);
});

test("function assigns only behind an if (no else) → its unconditional call proves nothing → flagged", () => {
  expect(u4("function boot() { if (c) global.CFG = {}; }\nboot();\n").length).toBe(1);
});

test("early conditional return before the assignment → call proves nothing → flagged", () => {
  expect(u4("function boot(x) { if (x) return; global.CFG = {}; }\nboot(1);\n").length).toBe(1);
});

test("bare implicit-global assigned only in a function → flagged", () => {
  expect(u4("function boot() { STATE = 1; }\n").length).toBe(1);
});

// ── now silent: statically determinable (the precision upgrades) ───────────────────────────

test("unconditional top-level def → clean", () => {
  expect(u4("global.CFG = {};\n").length).toBe(0);
});

test("`if (true)` / `if (1)` consequent is deterministic → clean", () => {
  expect(u4("if (true) { global.MODE = 1; }\n").length).toBe(0);
  expect(u4("if (1) { global.MODE = 1; }\n").length).toBe(0);
});

test("exhaustive if/else — BOTH arms assign the same global → clean", () => {
  expect(u4("if (c) { global.M = 1; } else { global.M = 2; }\n").length).toBe(0);
});

test("exhaustive if/else-if/else — every branch assigns the same global → clean", () => {
  expect(u4("if (a) { global.M = 1; } else if (b) { global.M = 2; } else { global.M = 3; }\n").length).toBe(0);
});

test("switch WITH default, every entry assigns before break → clean (fallthrough followed)", () => {
  expect(u4("switch (t) {\ncase 1: global.K = 1; break;\ncase 2:\ndefault: global.K = 0;\n}\n").length).toBe(0);
});

test("try/catch where BOTH sides assign → clean (assigned on every path)", () => {
  expect(u4("try { global.H = json('{}'); } catch (e) { global.H = {}; }\n").length).toBe(0);
});

test("ternary where BOTH arms assign the SAME global → clean", () => {
  expect(u4("cond ? (global.M = 1) : (global.M = 2);\n").length).toBe(0);
});

// (No do…while case: ucode has no `do` keyword — verified against the vendored lexer.c
// reserved_words table and the interpreter, which rejects `do { } while ();`.)

test("tier-1-lite: unconditional top-level call to the defining function → clean", () => {
  expect(u4("function boot() { global.CFG = {}; }\nboot();\n").length).toBe(0);
  expect(u4("boot();\nfunction boot() { global.CFG = {}; }\n").length).toBe(0); // hoisted call-first
});

test("tier-1-lite is transitive through direct calls (cycle-safe)", () => {
  expect(u4("function inner() { global.CFG = {}; }\nfunction outer() { inner(); }\nouter();\n").length).toBe(0);
  // mutual recursion must not hang or wrongly prove anything
  expect(u4("function a() { b(); }\nfunction b() { a(); global.X = 1; }\n").length).toBe(1);
});

test("tier-1-lite covers let/const-bound lambdas called unconditionally", () => {
  expect(u4("let boot = () => { global.CFG = {}; };\nboot();\n").length).toBe(0);
  expect(u4("const boot = function() { global.CFG = {}; };\nboot();\n").length).toBe(0);
  // uncalled lambda still flags, labeled with the variable name
  const d = u4("let boot = () => { global.CFG = {}; };\n");
  expect(d.length).toBe(1);
  expect(/inside function 'boot'/.test(d[0].message)).toBe(true);
});

test("a reassigned let-bound lambda proves nothing (call target unknowable)", () => {
  expect(u4("let boot = () => { global.CFG = {}; };\nboot = () => {};\nboot();\n").length).toBe(1);
});

test("static-test ternary takes exactly one arm (the SURE probe)", () => {
  // both arms assign SURE; lambda called unconditionally → fully proven, both variants
  expect(u4('let lambda = () => ((true) ? global.SURE = "lol" : global.SURE = "lolza");\nlambda();\n').length).toBe(0);
  expect(u4('let lambda = () => ((true) ? global.SURE = "lol" : (global.SURE = "lolza"));\nlambda();\n').length).toBe(0);
  // `(true) ? global.A = 1 : global.B = 2` at top level: A deterministic, B dead-arm conditional
  const d = u4("(true) ? (global.TAKEN = 1) : (global.DEAD = 2);\n");
  expect(d.length).toBe(1);
  expect(d[0].data?.globalName).toBe("DEAD");
  // `(false) ? … : …` — mirrored
  const d2 = u4("(false) ? (global.DEAD2 = 1) : (global.TAKEN2 = 2);\n");
  expect(d2.length).toBe(1);
  expect(d2[0].data?.globalName).toBe("DEAD2");
});

test("@global-declared name is exempt (the sanctioned opt-out)", () => {
  expect(u4("/** @global CFG */\nfunction boot() { global.CFG = {}; }\n").length).toBe(0);
});

test("a global with BOTH a shaky AND an unconditional def → clean", () => {
  expect(u4("global.CFG = {};\nfunction reset() { global.CFG = {}; }\n").length).toBe(0);
  expect(u4("global.M = 0;\nif (c) { global.M = 1; }\n").length).toBe(0);
  expect(u4("global.READY = 0;\nok && (global.READY = 1);\n").length).toBe(0);
});

test("locals in branches are never globals → clean", () => {
  expect(u4("if (c) { let tmp = 1; print(tmp); }\nfunction f() { let z = 2; return z; }\n").length).toBe(0);
});

test("normal code with no globals never trips it", () => {
  expect(u4("let a = 1;\nfunction f(p) { if (p) { return p; } return a; }\nprint(f(2));\n").length).toBe(0);
});

// ── severity / settings / related info ─────────────────────────────────────────────────────

test("severity: warning normally, error under 'use strict'", () => {
  expect(u4("function i() { global.X = 1; }\n").map(d => d.severity)).toEqual([2]);
  expect(u4("'use strict';\nfunction i() { global.X = 1; }\n").map(d => d.severity)).toEqual([1]);
});

test("mode 'warn' stays a warning under strict; 'off' disables", () => {
  expect(u4("'use strict';\nfunction i() { global.X = 1; }\n", { uncertainGlobalScope: 'warn' }).map(d => d.severity)).toEqual([2]);
  expect(u4("function i() { global.X = 1; }\n", { uncertainGlobalScope: 'off' }).length).toBe(0);
});

test("multiple shaky sites for the SAME global are cross-linked via relatedInformation", () => {
  const d = u4("if (a) { global.M = 1; }\nfunction f() { global.M = 2; }\n");
  expect(d.length).toBe(2);
  for (const diag of d) {
    expect(diag.relatedInformation?.length).toBe(1);
    expect(/also assigned non-deterministically/.test(diag.relatedInformation[0].message)).toBe(true);
  }
});

test("a single shaky site has no relatedInformation", () => {
  const d = u4("if (a) { global.M = 1; }\n");
  expect(d.length).toBe(1);
  expect(d[0].relatedInformation).toBeUndefined();
});

// ── UC8005: the read-site echo ─────────────────────────────────────────────────────────────

const u5 = (code, opt) => analyze(code, opt).diagnostics.filter(d => d.code === 'UC8005');

test("top-level read of a shaky global → UC8005 at the read, linked to the def", () => {
  const d = u5("function boot() { global.CFG = {}; }\nprint(CFG);\n");
  expect(d.length).toBe(1);
  expect(/may not exist here/.test(d[0].message)).toBe(true);
  expect(d[0].data?.globalName).toBe("CFG");
  expect(d[0].relatedInformation?.length).toBe(1); // → the def site inside boot()
});

test("UC8005 severity is one step below the def: Information non-strict, Warning strict", () => {
  expect(u5("function b() { global.X = 1; }\nprint(X);\n").map(d => d.severity)).toEqual([3]);            // Information
  expect(u5("'use strict';\nfunction b() { global.X = 1; }\nprint(X);\n").map(d => d.severity)).toEqual([2]); // Warning
});

test("read of a PROVEN global → no UC8005", () => {
  expect(u5("global.APP = 1;\nprint(APP);\n").length).toBe(0);                                  // unconditional
  expect(u5("function b() { global.X = 1; }\nb();\nprint(X);\n").length).toBe(0);               // tier-1-lite call
  expect(u5("if (c) { global.M = 1; } else { global.M = 2; }\nprint(M);\n").length).toBe(0);    // exhaustive
});

test("read INSIDE a function is flagged too — call timing is unknown in both directions", () => {
  const d = u5("function b() { global.X = 1; }\nfunction use() { print(X); }\n");
  expect(d.length).toBe(1);
  expect(d[0].data?.globalName).toBe("X");
});

test("read after the global is definitely assigned in the SAME body → silent", () => {
  expect(u5("function b() { global.X = 1; let c = X; print(c); }\n").length).toBe(0);
  // …but a read BEFORE the body's own assignment still flags (first call → null/throw)
  expect(u5("function b() { let c = X; global.X = 1; print(c); }\n").length).toBe(1);
});

test("read after a CALL to the defining function in the same body → silent (must-assign through the call)", () => {
  expect(u5("function load() { global.X = 1; }\nfunction g() { load(); return X; }\n").length).toBe(0);
});

test("a shadowing parameter or local of the same name is not a global read", () => {
  expect(u5("function b() { global.X = 1; }\nfunction h(X) { return X; }\n").length).toBe(0);
  expect(u5("function b() { global.X = 1; }\nfunction h() { let X = 2; return X; }\n").length).toBe(0);
});

test("@global-declared shaky global → no UC8005 (opt-out covers reads too)", () => {
  expect(u5("/** @global CFG */\nfunction boot() { global.CFG = {}; }\nprint(CFG);\n").length).toBe(0);
});

test("every read site gets its own UC8005", () => {
  expect(u5("function b() { global.X = 1; }\nprint(X);\nlet y = X;\n").length).toBe(2);
});

test("mode 'off' disables UC8005 too", () => {
  expect(u5("function b() { global.X = 1; }\nprint(X);\n", { uncertainGlobalScope: 'off' }).length).toBe(0);
});

// ── globalDefSites: go-to-definition support for symbol-less globals ───────────────────────

test("globalDefSites records global.X property spans, bare implicit globals, and @global tags", () => {
  const res = analyze("/** @global HOOK */\nglobal.CFG = 1;\nBARE = 2;\nfunction f() { global.CFG = 3; }\n");
  const sites = res.globalDefSites;
  expect(sites.get("CFG")?.length).toBe(2);   // both assignment sites
  expect(sites.get("BARE")?.length).toBe(1);  // bare implicit-global target
  expect(sites.get("HOOK")?.length).toBe(1);  // the @global tag name
  // the @global site points at the tag's name inside the comment
  const hook = sites.get("HOOK")[0];
  expect(res === null ? "" : "/** @global HOOK */".slice(hook.start, hook.end)).toBe("HOOK");
});
