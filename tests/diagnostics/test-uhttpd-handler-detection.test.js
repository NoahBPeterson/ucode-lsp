// Phase B — uhttpd handler-file detection. A file is a uhttpd handler when it is a `{%`
// template AND assigns `global.handle_request` (uhttpd's per-request entry point, looked up
// on the VM scope object). Both signals together are required; either alone is not a handler.
// The analysis exposes result.isUhttpdHandler, which gates the handler-specific phases (C/D/E).
const { test, expect } = require('bun:test');
const { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer.ts');
const { TextDocument } = require('vscode-languageserver-textdocument');

// Parse exactly as the server does: template-bridged when the file is a `{%` template.
function isHandler(code) {
  const doc = TextDocument.create('file:///tmp/h.uc', 'ucode', 1, code);
  const isTemplate = detectTemplateMode(code);
  const lexer = new UcodeLexer(code, { rawMode: !isTemplate });
  const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
  const ast = new UcodeParser(tokens, code).parse().ast;
  return new SemanticAnalyzer(doc).analyze(ast).isUhttpdHandler === true;
}

test('template + global.handle_request → handler', () => {
  expect(isHandler("{%\nglobal.handle_request = function(env) { return env; };\n%}\n")).toBe(true);
});
test('template + global.handle_request with imports and body → handler', () => {
  expect(isHandler("{%\n'use strict';\nglobal.handle_request = function(env) {\n  uhttpd.send('x');\n};\n%}\n")).toBe(true);
});

test('template WITHOUT global.handle_request → not a handler', () => {
  expect(isHandler("{%\nlet x = 1;\nprint(x);\n%}\n")).toBe(false);
});
test('global.handle_request WITHOUT template (plain script) → not a handler (FN-1 territory)', () => {
  expect(isHandler("global.handle_request = function(env) { return env; };\n")).toBe(false);
});
test('plain script, no handle_request → not a handler', () => {
  expect(isHandler("let x = 1;\nprint(x);\n")).toBe(false);
});
test('a local function handle_request in a template → not a handler (FN-2: not a global)', () => {
  expect(isHandler("{% function handle_request(env) { return env; } %}\n")).toBe(false);
});
