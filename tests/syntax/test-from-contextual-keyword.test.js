// docs/from-contextual-keyword.md: `from` is NOT a keyword in ucode. The lexer has no
// token for it - the import parser consumes it by string comparison
// (uc_compiler_keyword_consume(compiler, "from"), compiler.c) - so it is an ordinary
// identifier everywhere else. Our lexer minted TK_FROM unconditionally, so
// `let from = ...` / `function f(from, ...)` failed to parse and cascaded ~33 bogus
// diagnostics on real code (glinet vpn-client.uc).
//
// Oracle-verified 2026-08-01 (old binary AND master 81205a2) - ALL of these run:
//   let from = 1;                      function match_from(from, mac, typ) {}
//   export function from() {};        import { from } from "./m.uc";
//   import from from "./m.uc";        import * as from from "./m.uc";
//   obj.from   { from: 7 }            for (let from in o) {}
const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');

function analyzeAll(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parsed = new UcodeParser(lexer.tokenize(), code).parse();
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(parsed.ast);
  return [...lexer.errors, ...parsed.errors, ...result.diagnostics];
}
function parseErrors(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parsed = new UcodeParser(lexer.tokenize(), code).parse();
  return [...lexer.errors, ...parsed.errors];
}

test('let/const from - declaration names work', () => {
  expect(analyzeAll('let from = 1;\nprint(from, "\\n");\n').length).toBe(0);
  expect(analyzeAll('const from = { type: "x" };\nprint(from.type, "\\n");\n').length).toBe(0);
});

test('the glinet vpn-client shape: `let from = params.from ?? {}` is clean', () => {
  const code = 'function f(params) {\n    let from = params.from ?? {};\n    return from.type == "interface";\n}\nprint(f({}), "\\n");\n';
  expect(analyzeAll(code).length).toBe(0);
});

test('function parameters named from - no cascade', () => {
  const code = 'function match_from(from, mac, typ) {\n    return from.type == mac || typ;\n}\nprint(match_from({ type: "a" }, "a", false), "\\n");\n';
  const diags = analyzeAll(code);
  // the old bug produced "Expected identifier" + UC1001 Undefined variable: mac/typ
  expect(diags.length).toBe(0);
});

test('function named from, member access, object keys, for-in', () => {
  expect(analyzeAll('function from() { return 42; }\nprint(from(), "\\n");\n').length).toBe(0);
  expect(analyzeAll('let o = { from: 7 };\nprint(o.from, "\\n");\n').length).toBe(0);
  expect(analyzeAll('for (let from in { x: 1 })\n    print(from, "\\n");\n').length).toBe(0);
});

test('import statements still parse: named, aliased, default, namespace', () => {
  for (const code of [
    "import { open } from 'fs';\nopen('/dev/null', 'r');\n",
    "import { open as o } from 'fs';\no('/dev/null', 'r');\n",
    "import * as fs from 'fs';\nfs.open('/dev/null', 'r');\n",
  ]) {
    expect(parseErrors(code).length).toBe(0);
  }
});

test('a symbol literally named from can be imported (parse level)', () => {
  // import { from } from ..., import from from ..., import * as from from ...
  for (const code of [
    'import { from } from "./m.uc";\nfrom();\n',
    'import from from "./m.uc";\nfrom();\n',
    'import * as from from "./m.uc";\nfrom.x();\n',
  ]) {
    expect(parseErrors(code).length).toBe(0);
  }
});

test('missing from after an import list still errors', () => {
  const errs = parseErrors('import { open } "fs";\n');
  expect(errs.length).toBeGreaterThan(0);
  expect(errs.some((e) => /from/i.test(e.message))).toBe(true);
});

test('export { x } from "..." re-export is still rejected (analyzer check kept)', () => {
  // The parser accepts the shape (source captured on the node); the ANALYZER flags it.
  const diags = analyzeAll('export function f() {};\nexport { f } from "./x.uc";\n');
  expect(diags.some((e) => /re-export/i.test(e.message))).toBe(true);
});
