// Stage 2/3 of global-scope soundness: the Case-2 "read before it's defined" check (UC8002).
// Sound + conservative — fires only when the global is provably not in scope yet (in-file OR
// cross-file via a loadfile def-point), and stays silent everywhere it can't prove a problem.
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
  const fr = new FileResolver(FIX);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, uncertainGlobalScope: 'errorInStrict', ...opt }, fr).analyze(ast);
}
const u8002 = (code, opt) => analyze(code, opt).diagnostics.filter(d => d.code === 'UC8002');

test("in-file: read before the global is assigned → flagged", () => {
  expect(u8002("x = X;\nglobal.X = 1;\n").length).toBe(1);
});
test("in-file: read after the assignment → clean", () => {
  expect(u8002("global.X = 1;\nx = X;\n").length).toBe(0);
});
test("global assigned inside a function → never flagged (no call graph; conservative)", () => {
  expect(u8002("x = X;\nfunction init() { global.X = 1; }\n").length).toBe(0);
});
test("severity: warning normally, error under 'use strict' (errorInStrict default)", () => {
  expect(u8002("x = X;\nglobal.X = 1;\n").map(d => d.severity)).toEqual([2]);               // Warning
  expect(u8002("'use strict';\nx = X;\nglobal.X = 1;\n").map(d => d.severity)).toEqual([1]); // Error
});
test("mode 'warn' stays a warning even under 'use strict'", () => {
  expect(u8002("'use strict';\nx = X;\nglobal.X = 1;\n", { uncertainGlobalScope: 'warn' }).map(d => d.severity)).toEqual([2]);
});
test("mode 'off' disables it", () => {
  expect(u8002("x = X;\nglobal.X = 1;\n", { uncertainGlobalScope: 'off' }).length).toBe(0);
});
test("cross-file: read before loadfile that injects the global → flagged", () => {
  expect(u8002("y = uhttpd.docroot;\nloadfile('./injector.uc')();\n").length).toBe(1);
});
test("cross-file: read after the loadfile → clean", () => {
  expect(u8002("loadfile('./injector.uc')();\ny = uhttpd.docroot;\n").length).toBe(0);
});
test("normal local code never trips it (no false positives)", () => {
  expect(u8002("let a = 1;\nlet b = a + 1;\nprint(b);\nfunction f(p) { return p + a; }\n").length).toBe(0);
});
test("a host/@global-declared name (no in-file def) is not a UC8002 (handled by Case 3)", () => {
  // uhttpd is in the host-globals registry; with no in-file assignment there's nothing to be
  // "before", so this check stays out of it (and Case 3 keeps it from being UC1001).
  const ds = analyze("let d = uhttpd.docroot;\n").diagnostics;
  expect(ds.filter(d => d.code === 'UC8002').length).toBe(0);
  expect(ds.filter(d => d.code === 'UC1001').length).toBe(0);
});
