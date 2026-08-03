// A variable that still holds an UNSHARED fresh reference literal can never ==
// anything else (follow-up to the fresh-literal UC2009: `let yy = [1, 2];
// if (xx == yy)` is as impossible as `xx == [1, 2]` — ucode == on references is
// pointer identity, and a reference nothing else holds cannot be the other
// operand). Oracle-verified: pickRef([1,2]) and pickRef(sharedArr) both skip the
// branch; only aliasing (xx = yy) makes it true — and aliasing is an occurrence
// of yy, which disqualifies the lint.
//
// Soundness gate: the lint fires ONLY when the variable's declarator init is a
// fresh reference literal AND the variable's name has NO other occurrence in the
// file (whole-AST walk, so escapes AFTER the comparison — reachable via loop
// back-edges — also disqualify; shadows/keys/members bail conservatively).

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/freshvar-${n++}.uc`)) || [];
const impossible = (ds) => ds.filter(d => d.code === 'UC2009' && /always (false|true)/.test(d.message));

describe('unshared fresh-reference variable comparisons are impossible', () => {
  test('param == sole-use fresh array variable: always false', async () => {
    // Runtime: pickRef([1,2]) does NOT enter the branch — same contents, new ref.
    const ds = await diags(
      'function pickRef(xx) {\n' +
      '    let yy = [1, 2];\n' +
      '    if (xx == yy) {\n' +
      '        push(xx, 3);\n' +
      '    }\n' +
      '    return xx;\n' +
      '}\n' +
      'print(pickRef([1, 2]), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
    expect(impossible(ds)[0].message).toContain('always false');
  });

  test('reversed operands (yy == xx) flag the same way', async () => {
    const ds = await diags(
      'function f(xx) {\n' +
      '    let yy = { a: 1 };\n' +
      '    if (yy == xx) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f({ a: 1 }), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
  });

  test('strict === is the same pointer compare: always false', async () => {
    const ds = await diags(
      'function f(xx) {\n' +
      '    let yy = [1];\n' +
      '    if (xx === yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f([1]), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
  });

  test('!= flips the wording: always true', async () => {
    const ds = await diags(
      'function f(xx) {\n' +
      '    let yy = [1];\n' +
      '    if (xx != yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f([1]), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
    expect(impossible(ds)[0].message).toContain('always true');
  });

  test('fresh function expression variable flags too', async () => {
    const ds = await diags(
      'function f(cb) {\n' +
      '    let handler = function () { return 1; };\n' +
      '    if (cb == handler) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(null), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
  });

  test('a same-named variable in ANOTHER scope does not disqualify (scope-aware)', async () => {
    // The other function's `yy` is a different symbol — it cannot alias this one.
    const ds = await diags(
      'function other(xx) {\n' +
      '    let yy = 5;\n' +
      '    return xx == yy ? 1 : 0;\n' +
      '}\n' +
      'function f(xx) {\n' +
      '    let yy = [1];\n' +
      '    if (xx == yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(other(5), f([1]), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
  });

  test('comparison inside a loop still flags (sole use cannot alias across iterations)', async () => {
    const ds = await diags(
      'function f(items, xx) {\n' +
      '    let marker = [0];\n' +
      '    for (let item in items) {\n' +
      '        if (xx == marker) {\n' +
      '            return 1;\n' +
      '        }\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f([1], null), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
  });
});

describe('any other occurrence of the variable disqualifies the lint', () => {
  test('escaped BEFORE the comparison (push into a list): silent', async () => {
    const ds = await diags(
      'let registry = [];\n' +
      'function f(xx) {\n' +
      '    let yy = [1];\n' +
      '    push(registry, yy);\n' +
      '    if (xx == yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(registry[0]), "\\n");\n');
    expect(impossible(ds)).toEqual([]);
  });

  test('escaped AFTER the comparison: silent (loop back-edges make later uses reachable)', async () => {
    const ds = await diags(
      'let store = {};\n' +
      'function f(xx) {\n' +
      '    let yy = [1];\n' +
      '    if (xx == yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    store.last = yy;\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(store.last), "\\n");\n');
    expect(impossible(ds)).toEqual([]);
  });

  test('aliased into the other operand: silent (and genuinely true at runtime)', async () => {
    // Runtime: alias(null) returns 1 — xx = yy makes the comparison true.
    const ds = await diags(
      'function alias(xx) {\n' +
      '    let yy = [1];\n' +
      '    xx = yy;\n' +
      '    if (xx == yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(alias(null), "\\n");\n');
    expect(impossible(ds)).toEqual([]);
  });

  test('non-literal initializer: silent', async () => {
    const ds = await diags(
      'function make() { return [1]; }\n' +
      'function f(xx) {\n' +
      '    let yy = make();\n' +
      '    if (xx == yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(null), "\\n");\n');
    expect(impossible(ds)).toEqual([]);
  });

  test('exported fresh literal: silent (importers can alias it)', async () => {
    const ds = await diags(
      'export let defaults = { a: 1 };\n' +
      'export function f(xx) {\n' +
      '    if (xx == defaults) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n');
    expect(impossible(ds)).toEqual([]);
  });

  test('scalar initializer: not a reference, not this lint', async () => {
    const ds = await diags(
      'function f(xx) {\n' +
      '    let yy = 5;\n' +
      '    if (xx == yy) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(5), "\\n");\n');
    expect(impossible(ds)).toEqual([]);
  });

  test('the existing direct-literal lint is unaffected', async () => {
    const ds = await diags(
      'function f(xx) {\n' +
      '    if (xx == [1, 2]) {\n' +
      '        return 1;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(null), "\\n");\n');
    expect(impossible(ds).length).toBe(1);
  });
});
