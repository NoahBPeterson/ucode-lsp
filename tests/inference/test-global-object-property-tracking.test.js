// Global-object property parity with locals (0.7.36):
//  1. `global.X.prop = …` (nested-member base) writes are tracked — top-level AND inside
//     functions — exactly like the bare `X.prop = …` form and like local objects.
//  2. UC8006: a read of a property NEVER assigned on a fully-visible object-literal global
//     is provably always null → Warning. Tainted (silent) when the object escapes (value
//     use of `X`/`global.X`), takes a computed write, or is reassigned to a non-literal.
import { test, expect } from "bun:test";
import path from "path";
import { SemanticAnalyzer } from "../../src/analysis/semanticAnalyzer";
import { UcodeLexer } from "../../src/lexer/ucodeLexer";
import { UcodeParser } from "../../src/parser/ucodeParser";
import { FileResolver } from "../../src/analysis/fileResolver";
import { typeToString } from "../../src/analysis/symbolTable";
import { TextDocument } from "vscode-languageserver-textdocument";

const FIX = path.resolve(import.meta.dir, "..", "fixtures", "scopeorder");
function analyze(code, opt = {}) {
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = TextDocument.create("file://" + path.join(FIX, "a.uc"), "ucode", 1, code);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, uncertainGlobalScope: 'errorInStrict', ...opt }, new FileResolver(FIX)).analyze(ast);
}
const typeOf = (res, name) => { const s = res.symbolTable.lookup(name); return s ? typeToString(s.dataType) : "(none)"; };
const u6 = (code, opt) => analyze(code, opt).diagnostics.filter(d => d.code === 'UC8006');

// ── nested `global.X.prop = …` write tracking ───────────────────────────────────────────

test("global.X.prop = … at top level is tracked (was unknown)", () => {
  expect(typeOf(analyze("global.CACHE = {};\nglobal.CACHE.hot = 1;\nlet hh = CACHE.hot;\n"), "hh")).toBe("integer");
});

test("global.X.prop = … INSIDE a function is tracked (parity with locals)", () => {
  expect(typeOf(analyze("global.CACHE = {};\nfunction warm() { global.CACHE.hot = 1; }\nlet hh = CACHE.hot;\n"), "hh")).toBe("integer");
});

test("bare X.prop = … forms keep working (top level and in functions)", () => {
  expect(typeOf(analyze("global.CACHE = {};\nCACHE.hot = 1;\nlet hh = CACHE.hot;\n"), "hh")).toBe("integer");
  expect(typeOf(analyze("global.CACHE = {};\nfunction warm() { CACHE.hot = 1; }\nlet hh = CACHE.hot;\n"), "hh")).toBe("integer");
});

// ── UC8006: never-assigned property reads ────────────────────────────────────────────────

test("read of a never-assigned property on a fresh {} global → UC8006 Warning", () => {
  const d = u6("global.CACHE = {};\nlet hh = CACHE.hot;\n");
  expect(d.length).toBe(1);
  expect(d[0].severity).toBe(2);
  expect(/never assigned on global 'CACHE'/.test(d[0].message)).toBe(true);
  expect(/always null/.test(d[0].message)).toBe(true);
});

test("calling a never-assigned method is flagged too", () => {
  expect(u6("global.CACHE = {};\nCACHE.refresh();\n").length).toBe(1);
});

test("any visible write silences it: literal key, X.p=, global.X.p= in a function", () => {
  expect(u6("global.CACHE = { hot: 1 };\nlet hh = CACHE.hot;\n").length).toBe(0);
  expect(u6("global.CACHE = {};\nCACHE.hot = 1;\nlet hh = CACHE.hot;\n").length).toBe(0);
  expect(u6("global.CACHE = {};\nfunction warm() { global.CACHE.hot = 1; }\nlet hh = CACHE.hot;\n").length).toBe(0);
});

test("escape taints: X as a call argument, or `global.X` used as a value", () => {
  expect(u6("global.CACHE = {};\npopulate(CACHE);\nlet hh = CACHE.hot;\n").length).toBe(0);
  expect(u6("global.CACHE = {};\nlet alias = global.CACHE;\nlet hh = CACHE.hot;\n").length).toBe(0);
});

test("computed write taints; reassignment to a non-literal taints", () => {
  expect(u6("global.CACHE = {};\nlet k = 'hot';\nCACHE[k] = 1;\nlet hh = CACHE.hot;\n").length).toBe(0);
  expect(u6("global.CACHE = {};\nglobal.CACHE = mk();\nlet hh = CACHE.hot;\n").length).toBe(0);
});

test("for-in and computed READS don't hide a missing property", () => {
  expect(u6("global.CACHE = {};\nfor (let k in CACHE) print(k);\nlet hh = CACHE.hot;\n").length).toBe(1);
  expect(u6("global.CACHE = {};\nlet k = 'a';\nlet vv = CACHE[k];\nlet hh = CACHE.hot;\n").length).toBe(1);
});

test("@global-declared names are exempt; `off` disables", () => {
  expect(u6("/** @global CACHE */\nglobal.CACHE = {};\nlet hh = CACHE.hot;\n").length).toBe(0);
  expect(u6("global.CACHE = {};\nlet hh = CACHE.hot;\n", { uncertainGlobalScope: 'off' }).length).toBe(0);
});
