// Stage 1 (Case 3) of the global-scope-soundness work: ways to "explain" a name that has
// no visible declaration so it isn't a false UC1001 — (a) the built-in host-globals
// registry, (b) a developer-extensible JSDoc `@global` tag (optionally typed), and (c) a
// default-off blanket setting that treats every unknown read as an implicit global.
import { test, expect } from "bun:test";
import { SemanticAnalyzer } from "../../src/analysis/semanticAnalyzer";
import { UcodeLexer } from "../../src/lexer/ucodeLexer";
import { UcodeParser } from "../../src/parser/ucodeParser";
import { TextDocument } from "vscode-languageserver-textdocument";

function analyze(code, opt = {}) {
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = TextDocument.create("file:///t.uc", "ucode", 1, code);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, ...opt }).analyze(ast);
}
const uc1001 = (r) => r.diagnostics.filter(d => d.code === 'UC1001');

test("built-in host global (uhttpd) read is not UC1001", () => {
  expect(uc1001(analyze("let x = uhttpd.docroot;\n")).length).toBe(0);
});

test("a name NOT in the registry is still UC1001 (no blanket pass)", () => {
  expect(uc1001(analyze("let x = totallyUnknownXyz;\n")).length).toBe(1);
});

test("JSDoc @global (bare) explains a name", () => {
  expect(uc1001(analyze("/** @global ubus */\nlet x = ubus;\n")).length).toBe(0);
});

test("JSDoc @global {type} name is accepted (suppresses UC1001); typing is a fast-follow", () => {
  // Stage 1 is suppression-only — `@global {object} conn` parses and silences UC1001.
  // (Typing the symbol from the {type} is deferred; see docs/global-scope-soundness.md.)
  expect(uc1001(analyze("/** @global {object} conn */\nlet base = conn;\n")).length).toBe(0);
});

test("@global also suppresses the call form (UC1002)", () => {
  const r = analyze("/** @global doStuff */\ndoStuff();\n");
  expect(r.diagnostics.filter(d => d.code === 'UC1002').length).toBe(0);
});

test("blanket assumeUndefinedGlobalsDefined suppresses unknown reads (default off)", () => {
  const code = "let x = totallyUnknownXyz;\n";
  expect(uc1001(analyze(code, {})).length).toBe(1);                                  // default: flagged
  expect(uc1001(analyze(code, { assumeUndefinedGlobalsDefined: true })).length).toBe(0); // on: silent
});

test("a real local is unaffected by the blanket setting", () => {
  // sanity: turning the blanket on doesn't break normal resolution / other diagnostics
  const r = analyze("let y = 1;\nlet z = y + 1;\n", { assumeUndefinedGlobalsDefined: true });
  expect(uc1001(r).length).toBe(0);
});
