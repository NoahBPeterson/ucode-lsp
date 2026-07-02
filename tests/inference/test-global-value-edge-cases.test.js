// Global-VALUE inference edge cases (companion to the definedness axis). Each was a real gap
// found by probing; this pins the fixes: bare implicit-global object/function shapes (08),
// cross-file scalar loadfile globals (09), in-file global-function return types (12), global
// array element type (05), `delete X.a` shape update (07), and the cross-type reassignment
// diagnostic UC8003 (04).
import { test, expect } from "bun:test";
import path from "path";
import { SemanticAnalyzer } from "../../src/analysis/semanticAnalyzer";
import { UcodeLexer } from "../../src/lexer/ucodeLexer";
import { UcodeParser } from "../../src/parser/ucodeParser";
import { FileResolver } from "../../src/analysis/fileResolver";
import { typeToString } from "../../src/analysis/symbolTable";
import { TextDocument } from "vscode-languageserver-textdocument";

const FIX = path.resolve(import.meta.dir, "..", "fixtures", "globalvalue");
function res(code, opt = {}) {
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = TextDocument.create("file://" + path.join(FIX, "a.uc"), "ucode", 1, code);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, uncertainGlobalScope: 'errorInStrict', ...opt }, new FileResolver(FIX)).analyze(ast);
}
const codes = (code, opt) => res(code, opt).diagnostics.map(d => d.code);
// Resolve a variable's type from an analysis result (server-less), union-safe.
function hoverTypeFromResult(r, name) {
  const sym = r.symbolTable.lookup(name);
  return sym?.dataType !== undefined ? typeToString(sym.dataType) : 'unknown';
}

test("08 bare implicit-global object member types (X = {a:1}; X.a)", () => {
  // `y = X.a` → integer means the bare implicit global object got its shape.
  const r = res("X = { a: 1 };\ny = X.a;\n");
  const sym = r.symbolTable.lookup('X');
  expect(sym?.propertyTypes?.get('a')).toBe('integer');
});

test("12 in-file global function return type (global.fn = function; fn())", () => {
  const r = res("global.fn = function(){ return 7; };\nlet out = fn();\n");
  expect(hoverTypeFromResult(r, 'out')).toBe('integer');
});

test("09 cross-file scalar loadfile global carries its type", () => {
  const r = res("loadfile('./provider.uc')();\nlet a = S;\nlet b = NAME;\n");
  expect(hoverTypeFromResult(r, 'a')).toBe('integer');
  expect(hoverTypeFromResult(r, 'b')).toBe('string');
});

test("05 global array element type (global.X = ['a']; X[0])", () => {
  // element resolves to string (indexing may also be null — that's fine).
  const r = res("global.X = ['a','b'];\nlet e = X[0];\n");
  const t = hoverTypeFromResult(r, 'e');
  expect(/string/.test(t)).toBe(true);
});

test("07 delete X.a makes a later read null, not the stale type", () => {
  const r = res("global.X = { a: 1 };\ndelete X.a;\nlet g = X.a;\n");
  expect(hoverTypeFromResult(r, 'g')).toBe('null');
});

// 04 redesigned (user direction): UC8003 fires only when the TYPE genuinely cannot be
// statically determined — a cross-type conflict where at least one assignment sits inside a
// FUNCTION (call timing unknowable). Straight-line top-level cross-type reassignment is
// SSA-determinable (each read's type is positional — see the SSA test below) → silent.
// Always a WARNING, never an Error: cross-type reassignment is legal, deterministic ucode.
test("04 straight-line top-level cross-type reassignment is SSA-determinable → NOT flagged", () => {
  expect(codes("global.X = 1;\nglobal.X = 'str';\n")).not.toContain('UC8003');
  expect(codes("'use strict';\nglobal.X = 1;\nglobal.X = 'str';\n")).not.toContain('UC8003');
});
test("04 SSA: reads between top-level reassignments get the positional type", () => {
  const r = res("global.M = 1;\nlet aa = M;\nglobal.M = 'fast';\nlet bb = M;\n");
  expect(hoverTypeFromResult(r, 'aa')).toBe('integer');
  expect(hoverTypeFromResult(r, 'bb')).toBe('string');
});
test("04 cross-type where one assignment is inside a function → UC8003 Warning (even strict)", () => {
  const d = res("global.X = 1;\nfunction f() { global.X = 'str'; }\n").diagnostics.filter(x => x.code === 'UC8003');
  expect(d.length).toBe(1);
  expect(d[0].severity).toBe(2); // Warning
  expect(/function 'f'/.test(d[0].message)).toBe(true);
  expect(/cannot be statically determined/.test(d[0].message)).toBe(true);
  const strict = res("'use strict';\nglobal.X = 1;\nfunction f() { global.X = 'str'; }\n").diagnostics.find(x => x.code === 'UC8003');
  expect(strict?.severity).toBe(2); // still Warning under 'use strict' — no runtime failure to mirror
});
test("04 two functions assigning conflicting types → both sites flagged", () => {
  expect(codes("function a() { global.X = 1; }\nfunction b() { global.X = 'str'; }\n")
    .filter(c => c === 'UC8003').length).toBe(2);
});
test("04 top-level branch cross-type is a knowable phi-union → NOT flagged", () => {
  expect(codes("global.X = 1;\nif (c) { global.X = 'str'; }\n")).not.toContain('UC8003');
});
test("04 same-type reassignment is NOT flagged (even in a function); local `let` never", () => {
  expect(codes("global.X = 1;\nglobal.X = 2;\n")).not.toContain('UC8003');
  expect(codes("global.X = 1;\nfunction f() { global.X = 2; }\n")).not.toContain('UC8003');
  expect(codes("let X = 1;\nX = 'str';\n")).not.toContain('UC8003');
});
test("04 respects the off setting", () => {
  expect(codes("global.X = 1;\nfunction f() { global.X = 'str'; }\n", { uncertainGlobalScope: 'off' })).not.toContain('UC8003');
});
