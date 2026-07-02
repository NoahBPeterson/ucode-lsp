// require() UC8001 suppression is resolution-aware AND version-aware: a require of a module
// that provably exists at the configured target doesn't warn; one that doesn't (unresolvable,
// version-gated-out, dynamic, or a host-injected global that isn't a module) still warns.
// Analyzer-level (no server config race) so the target version is deterministic.
import { test, expect } from "bun:test";
import path from "path";
import { SemanticAnalyzer } from "../../src/analysis/semanticAnalyzer";
import { UcodeLexer } from "../../src/lexer/ucodeLexer";
import { UcodeParser } from "../../src/parser/ucodeParser";
import { FileResolver } from "../../src/analysis/fileResolver";
import { TextDocument } from "vscode-languageserver-textdocument";

const FIX = path.resolve(import.meta.dir, "..", "fixtures", "constimport"); // has util.uc on disk
function u8(code, targetVersion = 'main') {
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = TextDocument.create("file://" + path.join(FIX, "t.uc"), "ucode", 1, code);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, warnUnguardedThrowingCalls: true, targetVersion }, new FileResolver(FIX))
    .analyze(ast).diagnostics.filter(d => d.code === 'UC8001').length;
}

test("core builtin require never warns (fs on every target)", () => {
  for (const tv of ['22.03', '25.12', 'main']) expect(u8('require("fs");\n', tv)).toBe(0);
});

test("version-gated builtin: socket suppressed at 24.10+, flagged at 22.03", () => {
  expect(u8('require("socket");\n', '24.10')).toBe(0); // socket feed-available 24.10
  expect(u8('require("socket");\n', '22.03')).toBe(1); // not before 24.10 → will fail there
});

test("version-gated builtin: zlib suppressed at 25.12, flagged earlier", () => {
  expect(u8('require("zlib");\n', '25.12')).toBe(0);
  expect(u8('require("zlib");\n', '24.10')).toBe(1); // zlib feed-available only at 25.12
});

test("a resolvable sibling .uc file is not flagged; an unknown name is", () => {
  expect(u8('require("util");\n')).toBe(0);  // constimport/util.uc exists
  expect(u8('require("lolza");\n')).toBe(1); // no such module
});

test("a host-injected global (uhttpd) is NOT a require target → still flagged", () => {
  // uhttpd is injected into scope, not requireable; require("uhttpd") would fail → warn.
  expect(u8('require("uhttpd");\n')).toBe(1);
});

test("dynamic require argument always warns (can't verify)", () => {
  expect(u8('function f(name) { require(name); }\n')).toBe(1);
});

// --- loadfile: same resolution-aware treatment (path exists → silent) ---
function diags(code, opt = {}) {
  const ast = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse().ast;
  const doc = TextDocument.create("file://" + path.join(FIX, "t.uc"), "ucode", 1, code);
  return new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, warnUnguardedThrowingCalls: true, ...opt }, new FileResolver(FIX)).analyze(ast).diagnostics;
}

test("loadfile of an existing path is not flagged; a missing path is", () => {
  expect(diags('loadfile("./util.uc")();\n').filter(d => d.code === 'UC8001').length).toBe(0); // util.uc exists in FIX
  expect(diags('loadfile("./nope.uc")();\n').filter(d => d.code === 'UC8001').length).toBe(1);
});

test("require/loadfile 'not found' messages are specific", () => {
  const reqMsg = diags('require("lolza");\n').find(d => d.code === 'UC8001').message;
  expect(/Module 'lolza' was not found/.test(reqMsg)).toBe(true);
  const lfMsg = diags('loadfile("./nope.uc")();\n').find(d => d.code === 'UC8001').message;
  expect(/File '\.\/nope\.uc' was not found/.test(lfMsg)).toBe(true);
});

test("warnResolvableThrowingCalls setting flags even a resolvable require/loadfile", () => {
  expect(diags('require("fs");\n', { warnResolvableThrowingCalls: true }).filter(d => d.code === 'UC8001').length).toBe(1);
  expect(diags('loadfile("./util.uc")();\n', { warnResolvableThrowingCalls: true }).filter(d => d.code === 'UC8001').length).toBe(1);
});

const u8c = (code, opt) => diags(code, opt).filter(d => d.code === 'UC8001');

test("render is polymorphic: function arg silent, resolvable path silent, missing path warns", () => {
  expect(u8c('render(function(){ print(1); });\n').length).toBe(0); // fn → propagates (like call)
  expect(u8c('render("./util.uc");\n').length).toBe(0);              // template file exists
  expect(u8c('render("./nope.uc");\n').length).toBe(1);              // template missing
  expect(u8c('function f(x){ render(x); }\n').length).toBe(1);       // dynamic → conservative
});

test("severity under 'use strict': only json is an Error by default; the rest are Warnings", () => {
  const sev = (code) => u8c("'use strict';\n" + code)[0]?.severity;
  expect(sev('json("x");\n')).toBe(1);            // Error
  expect(sev('loadstring("1+");\n')).toBe(2);     // Warning
  expect(sev('render("./nope.uc");\n')).toBe(2);  // Warning
  expect(sev('require("lolza");\n')).toBe(2);     // Warning
  expect(sev('loadfile("./nope.uc");\n')).toBe(2);// Warning
});

test("strictThrowingCalls setting escalates ALL of them to Error under strict", () => {
  const sev = (code) => u8c("'use strict';\n" + code, { strictThrowingCalls: true })[0]?.severity;
  expect(sev('loadstring("1+");\n')).toBe(1);
  expect(sev('render("./nope.uc");\n')).toBe(1);
  expect(sev('require("lolza");\n')).toBe(1);
});
