// docs/sign-after-exponent-number-lexing.md — the version-gated half.
//
// A hex literal ending in `e`/`E` directly followed by `+`/`-` (`0x1e+2`) is an
// "Invalid number literal" on every deployed ucode pin (24.10/25.12/main's 3ec4e5c):
// the old lexer consumed the sign into the lexeme. Upstream 65d41a1 (master) splits
// the token instead (`0x1e+2` → 30 + 2 → 32). We lex the new way everywhere and
// flag UC6005 on targets below the fix — same optimistic-'main' stance as
// exportFunctionNoSemicolon. Verified against both binaries 2026-08-01:
//   old: 1e+5 → 100000, 0x1e+2 → error, 0x1e+ 2 → error, 0xe+1 → error, 0x1e + 2 → 30 2
//   new: 1e+5 → 100000, 0x1e+2 → 32,    0x1e+ 2 → 32,    0xe+1 → 15,    0x1e + 2 → 30 2
const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');

function diagnostics(code, targetVersion) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const lexer = new UcodeLexer(code, { rawMode: true });
  const ast = new UcodeParser(lexer.tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd(), targetVersion }).analyze(ast);
  return [...lexer.errors, ...result.diagnostics];
}
const codesOf = (diags) => diags.map((d) => String(d.code ?? ''));

test('0x1e+2 on the default 25.12 target → UC6005 (invalid number literal there)', () => {
  const diags = diagnostics('let x = 0x1e+2;\nprint(x);\n', '25.12');
  expect(codesOf(diags)).toContain('UC6005');
});

test('the hex-sign UC6005 is an ERROR, full stop — strict mode is not consulted', () => {
  // A parse-level gate has no guard or fallback (the target cannot lex the file), so
  // unlike availability gates there is no strict/non-strict severity split: the
  // severityOverride bypasses the strictMode check entirely. Same Error either way.
  for (const src of ['let x = 0x1e+2;\nprint(x);\n', "'use strict';\nlet x = 0x1e+2;\nprint(x);\n"]) {
    const gate = diagnostics(src, '25.12').find((d) => String(d.code) === 'UC6005');
    expect(gate.severity).toBe(1); // DiagnosticSeverity.Error
  }
});

test('0x1e+2 on target main → clean (master splits the token)', () => {
  const diags = diagnostics('let x = 0x1e+2;\nprint(x);\n', 'main');
  expect(codesOf(diags)).not.toContain('UC6005');
  expect(codesOf(diags)).not.toContain('UC6016');
});

test('0x1e+ 2 (space after the sign) is still flagged on 25.12 — old ucode consumed the sign', () => {
  const diags = diagnostics('let x = 0x1e+ 2;\nprint(x);\n', '25.12');
  expect(codesOf(diags)).toContain('UC6005');
});

test('0xe+1 (bare hex-e literal) is flagged on 25.12', () => {
  const diags = diagnostics('let x = 0xe+1;\nprint(x);\n', '25.12');
  expect(codesOf(diags)).toContain('UC6005');
});

test('0x1e + 2 (space before the sign) is clean on every target', () => {
  for (const v of ['24.10', '25.12', 'main']) {
    const diags = diagnostics('let x = 0x1e + 2;\nprint(x);\n', v);
    expect(codesOf(diags)).not.toContain('UC6005');
    expect(codesOf(diags)).not.toContain('UC6016');
  }
});

test('0xff+1 (no trailing e digit) is clean — the sign never bonded to the literal', () => {
  const diags = diagnostics('let x = 0xff+1;\nprint(x);\n', '25.12');
  expect(codesOf(diags)).not.toContain('UC6005');
});

test('1e+5 (decimal exponent) is clean on every target — never version-gated', () => {
  for (const v of ['24.10', '25.12', 'main']) {
    const diags = diagnostics('let x = 1e+5;\nprint(x);\n', v);
    expect(codesOf(diags)).not.toContain('UC6005');
    expect(codesOf(diags)).not.toContain('UC6016');
  }
});
