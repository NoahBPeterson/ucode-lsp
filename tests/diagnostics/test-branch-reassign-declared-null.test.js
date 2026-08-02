// docs/uc2009-branch-reassign-declared-null.md - UC2009 FP on the empty-string
// normalization idiom.
//
// effectiveSymbolType() kept only the LATEST assignment in its single currentType
// slot: in `let p; p = params.x; if (p == "") p = null;` the branch write moved
// currentTypeEffectiveFrom PAST the test, so the type query at the test fell back to
// the DECLARED type (null from the bare `let p;`) and UC2009 declared the comparison
// impossible. The smoking gun: `if (p == "") p = 7;` still claimed `null`.
// Oracle-verified: set_password({password:""}) really takes the branch.
const { test, expect } = require('bun:test');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { UcodeLexer } = require('../../src/lexer');
const { UcodeParser } = require('../../src/parser');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer');

function diagnostics(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const lexer = new UcodeLexer(code, { rawMode: true });
  const ast = new UcodeParser(lexer.tokenize(), code).parse().ast;
  const result = new SemanticAnalyzer(doc, { workspaceRoot: process.cwd() }).analyze(ast);
  return [...lexer.errors, ...result.diagnostics];
}
const uc2009 = (code) => diagnostics(code).filter((d) => String(d.code) === 'UC2009');

test('the normalization idiom: assign then `if (p == "") p = null` is clean', () => {
  const code = 'function f(params) {\n    let p;\n    p = params.password;\n    if (p == "") p = null;\n    return p;\n}\nprint(f({ password: "" }), "\\n");\n';
  expect(uc2009(code).length).toBe(0);
});

test('branch assigning a different value (`p = 7`) is also clean', () => {
  const code = 'function f(params) {\n    let p;\n    p = params.password;\n    if (p == "") p = 7;\n    return p;\n}\nprint(f({}), "\\n");\n';
  expect(uc2009(code).length).toBe(0);
});

test('the real glinet shape (guarded branch, multi-declarator) is clean', () => {
  const code = [
    'function set_portal(params, ctx) {',
    '    params = params ?? {};',
    '    let auth_mode = params.auth_mode;',
    '    let username, password;',
    '    if (auth_mode == 2) {',
    '        password = params.password;',
    '        if (password == "") password = null;',
    '    } else if (auth_mode == 3) {',
    '        username = params.username ?? params.usrname;',
    '        password = params.password;',
    '        if (username == "") username = null;',
    '        if (password == "") password = null;',
    '    }',
    '    return [username, password];',
    '}',
    'print(set_portal({ auth_mode: 2, password: "x" }, null), "\\n");',
  ].join('\n');
  expect(uc2009(code).length).toBe(0);
});

test('TRUE POSITIVE kept: an uninitialized let compared before ANY assignment still fires', () => {
  const code = 'function f() {\n    let p;\n    if (p == "") return 1;\n    return 0;\n}\nprint(f(), "\\n");\n';
  expect(uc2009(code).length).toBe(1);
});

test('TRUE POSITIVE kept: assigned a provable null, compared, then reassigned', () => {
  const code = 'function f() {\n    let p;\n    p = null;\n    if (p == "") p = 7;\n    return p;\n}\nprint(f(), "\\n");\n';
  expect(uc2009(code).length).toBe(1);
});

test('between-assignments hover semantics: earlier assignment type governs, not declared', () => {
  // Same mechanism, no branch: after `p = "s"`, before `p = 7`, p is a string -
  // comparing to an array VARIABLE (not a fresh literal, which has its own rule)
  // must flag as string-vs-array (impossible), NOT as null-vs-array.
  const code = 'function f() {\n    let arr = [1];\n    let p;\n    p = "s";\n    if (p == arr) return 1;\n    p = 7;\n    return p;\n}\nprint(f(), "\\n");\n';
  const diags = uc2009(code);
  expect(diags.length).toBe(1);
  expect(diags[0].message).toContain('string');
  expect(diags[0].message).not.toContain('`null`');
});
