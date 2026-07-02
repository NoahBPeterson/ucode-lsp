// UC8007: the local counterpart of UC8006 — a read of a property NEVER assigned on a
// `let x = { … }` object literal whose shape is fully visible → provably always null.
// Resolution is symbol-identity-based (lookupAtPosition + declaredAt), so shadowing is
// precise; closure writes count via the existing propertyTypes tracking; spread/computed-key
// literals, escapes, computed writes, and reassignment all forfeit the proof (silent).
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
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, ...opt }, new FileResolver(FIX)).analyze(ast);
}
const u7 = (code, opt) => analyze(code, opt).diagnostics.filter(d => d.code === 'UC8007');

test("read of a never-assigned property on a fresh local {} → UC8007 Warning", () => {
  const d = u7("let cache = {};\nlet hh = cache.hot;\nprint(hh);\n");
  expect(d.length).toBe(1);
  expect(d[0].severity).toBe(2);
  expect(/never assigned on 'cache'/.test(d[0].message)).toBe(true);
  expect(/always null/.test(d[0].message)).toBe(true);
});

test("calling a never-assigned method flags too", () => {
  expect(u7("let cache = {};\ncache.refresh();\n").length).toBe(1);
});

test("any visible write silences: literal key, x.p=, closure write", () => {
  expect(u7("let cache = { hot: 1 };\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
  expect(u7("let cache = {};\ncache.hot = 1;\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
  expect(u7("let cache = {};\nfunction warm() { cache.hot = 1; }\nwarm();\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
});

test("escapes taint: call argument, alias assignment", () => {
  expect(u7("let cache = {};\npopulate(cache);\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
  expect(u7("let cache = {};\nlet alias = cache;\nalias.hot = 1;\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
});

test("computed write and reassignment taint; bucket idiom stays silent", () => {
  expect(u7("let cache = {};\nlet k = 'x';\ncache[k] = 1;\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
  expect(u7("let cache = {};\ncache = mk();\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
  expect(u7("let buckets = {};\nfor (let it in items) { buckets[it.k] ??= []; }\nlet hh = buckets.x;\nprint(hh);\n").length).toBe(0);
});

test("a spread or computed-key literal is not fully enumerable → no claim", () => {
  expect(u7("let src = getcfg();\nlet cache = { ...src };\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
});

test("for-in and computed READS don't hide a missing property", () => {
  expect(u7("let cache = {};\nfor (let k in cache) print(k);\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(1);
  expect(u7("let cache = {};\nlet vv = cache['a'];\nlet hh = cache.hot;\nprint(hh, vv);\n").length).toBe(1);
});

test("shadowing is symbol-precise: inner literal has the key, only the OUTER read flags", () => {
  const code = "let cache = {};\nfunction f() { let cache = { hot: 1 }; return cache.hot; }\nlet hh = cache.hot;\nprint(hh, f());\n";
  const d = u7(code);
  expect(d.length).toBe(1);
  // the flagged read is the OUTER `cache.hot` (line 3), not the inner shadowed one (line 2)
  expect(d[0].range.start.line).toBe(2);
});

test("delete can't add a property — doesn't taint (and the read still flags)", () => {
  expect(u7("let cache = {};\ndelete cache.old;\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(1);
});

test("`export { cache }` hands the object to other modules — an escape → silent", () => {
  expect(u7("let cache = {};\nexport { cache };\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
});

test("import bindings and property keys are names, not value uses (no interference)", () => {
  // an imported name and an object KEY spelled like the candidate must not taint it
  expect(u7("import { util } from './util.uc';\nlet cache = {};\nlet oo = { cache: 1 };\nlet hh = cache.hot;\nprint(hh, oo, util);\n").length).toBe(1);
});

test("object-literal GLOBALS are UC8006's turf — no double report", () => {
  const res = analyze("global.CACHE = {};\nlet hh = CACHE.hot;\nprint(hh);\n", { uncertainGlobalScope: 'errorInStrict' });
  expect(res.diagnostics.filter(d => d.code === 'UC8007').length).toBe(0);
  expect(res.diagnostics.filter(d => d.code === 'UC8006').length).toBe(1);
});

// ── severity: a provably-always-null read is a definite bug → Error under 'use strict' ─────

test("UC8007 severity: Warning normally, Error under 'use strict'", () => {
  expect(u7("let cache = {};\nlet hh = cache.hot;\nprint(hh);\n").map(d => d.severity)).toEqual([2]);
  expect(u7("'use strict';\nlet cache = {};\nlet hh = cache.hot;\nprint(hh);\n").map(d => d.severity)).toEqual([1]);
});

test("UC8006 severity: Warning normally, Error under strict; 'warn' mode pins Warning", () => {
  const sev = (code, opt) => analyze(code, opt).diagnostics.find(d => d.code === 'UC8006')?.severity;
  expect(sev("global.CACHE = {};\nlet hh = CACHE.hot;\nprint(hh);\n")).toBe(2);
  expect(sev("'use strict';\nglobal.CACHE = {};\nlet hh = CACHE.hot;\nprint(hh);\n")).toBe(1);
  expect(sev("'use strict';\nglobal.CACHE = {};\nlet hh = CACHE.hot;\nprint(hh);\n", { uncertainGlobalScope: 'warn' })).toBe(2);
});

// ── tricky fail-to-pass cases: adversarial shapes the walker must classify correctly ───────

test("computed-key literal `{ [k]: 1 }` is not fully enumerable → no claim", () => {
  expect(u7("let k = 'a';\nlet cache = { [k]: 1 };\nlet hh = cache.hot;\nprint(hh);\n").length).toBe(0);
});

test("writing THROUGH a missing property (`cache.a.b = 1`) flags the read of the base prop", () => {
  const d = u7("let cache = {};\ncache.a.b = 1;\n");
  expect(d.length).toBe(1);
  expect(/'a'/.test(d[0].message)).toBe(true); // 'a' must exist to write .b on it — it never does
});

test("self-referential assignment `oo.x = oo.y` — RHS read flags, LHS write doesn't", () => {
  const d = u7("let oo = {};\noo.x = oo.y;\nprint(oo.x);\n");
  expect(d.length).toBe(1);
  expect(/'y'/.test(d[0].message)).toBe(true);
});

test("delete of an EXISTING key is not 'never assigned' (that's #07's null-typing, not UC8007)", () => {
  expect(u7("let oo = { p: 1 };\ndelete oo.p;\nlet z = oo.p;\nprint(z);\n").length).toBe(0);
});

test("ternary and return are value uses → escape → silent", () => {
  expect(u7("let oo = {};\nlet x = c ? oo : other;\nlet hh = oo.hot;\nprint(x, hh);\n").length).toBe(0);
  expect(u7("let oo = {};\nfunction get() { return oo; }\nlet hh = oo.hot;\nprint(hh, get());\n").length).toBe(0);
});

test("spreading the object (`{ ...oo }`) taints (conservative — read-only, but treated as a value use)", () => {
  expect(u7("let oo = {};\nlet merged = { ...oo };\nlet hh = oo.hot;\nprint(merged, hh);\n").length).toBe(0);
});

test("two same-named bindings in sibling blocks are independent — only the empty one flags", () => {
  const d = u7("{ let cc = {};\nprint(cc.a); }\n{ let cc = { b: 1 };\nprint(cc.b); }\n");
  expect(d.length).toBe(1);
  expect(d[0].range.start.line).toBe(1); // the `cc.a` read in the FIRST block
});

test("compound assignment `cache.p ||= 1` counts as a write; a read in its RHS still flags", () => {
  expect(u7("let cache = {};\ncache.p ||= 1;\nlet z = cache.p;\nprint(z);\n").length).toBe(0);
  const d = u7("let cache = {};\ncache.a ||= cache.b;\nprint(cache.a);\n");
  expect(d.length).toBe(1);
  expect(/'b'/.test(d[0].message)).toBe(true);
});
