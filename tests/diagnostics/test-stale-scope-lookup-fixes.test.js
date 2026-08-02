// The seven confirmed stale-scope lookup bugs (docs/stale-scope-lookup-audit.md):
// siblings of the 0.7.82 checkIdentifier fix. Each was a plain scope-chain
// symbolTable.lookupOpenScopes() running in a window where the symbol's scope had exited
// (the if-statement post-visit re-check, post-traversal passes, or post-analysis
// hover/completion), resolving a builtin / module / outer same-name symbol
// instead of the local. All repros oracle-verified against real ucode.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/ssl-${n++}.uc`)) || [];
const byCode = (ds, c) => ds.filter(d => d.code === c);

describe('diagnostics-path stale-scope bugs', () => {
  // #1 resolveRangedCall: the BUILTIN_RETURN_RANGE lint resolved the callee with a
  // plain lookup, so a block-local function named `index` was ranged like builtin
  // index() (>= -1). Runtime prints "hit".
  test('ranged-call lint: block-local function named index is not builtin-ranged', async () => {
    const ds = await diags(
      'if (true) {\n' +
      '    let index = function (a, b) { return -5; };\n' +
      '    if (index("x", "y") == -5) print("hit", "\\n");\n' +
      '}\n');
    expect(byCode(ds, 'UC2009')).toEqual([]);
  });

  // ...and the genuine builtin range lint still fires with no local in sight.
  test('ranged-call lint: the real builtin index() == -5 still fires', async () => {
    const ds = await diags('if (index("abc", "z") == -5) print("no", "\\n");\n');
    expect(byCode(ds, 'UC2009').length).toBe(1);
  });

  // #2 checkMemberExpression: member access on an inner object shadowing an outer
  // ARRAY resolved the outer symbol -> "Property does not exist on array type".
  // Runtime prints "eth0".
  test('member access on a block-local object shadowing an outer array', async () => {
    const ds = await diags(
      'let cfg = [1, 2, 3];\n' +
      'if (true) {\n' +
      '    let cfg = { name: "eth0" };\n' +
      '    print(cfg.name, "\\n");\n' +
      '}\n');
    expect(byCode(ds, 'UC5003')).toEqual([]);
  });

  // #5 checkAssignmentExpression element tracking WROTE through the wrong symbol:
  // the inner block's buf[0] = 42 landed on the OUTER buf, so the post-block read
  // was typed integer and the string comparison errored. Runtime prints "yes".
  test('element write inside a block does not corrupt the outer same-name array', async () => {
    const ds = await diags(
      'let buf = ["a", "b"];\n' +
      'if (true) {\n' +
      '    let buf = [0, 1];\n' +
      '    buf[0] = 42;\n' +
      '}\n' +
      'if (buf[0] == "a") print("yes", "\\n");\n');
    expect(byCode(ds, 'UC2009')).toEqual([]);
  });

  // #6 checkCallExpression module dispatch: a block-local object shadowing
  // `import * as fs` had its calls checked against the fs MODULE signatures.
  test('calls on a block-local shadowing a namespace import skip module signatures', async () => {
    const ds = await diags(
      "import * as fs from 'fs';\n" +
      'if (true) {\n' +
      '    let fs = { open: function (a, b, c, d, e) { return a; } };\n' +
      '    print(fs.open(1, 2, 3, 4, 5), "\\n");\n' +
      '}\n');
    expect(byCode(ds, 'UC2004')).toEqual([]);
  });

  // ...and real module calls still get argument-checked.
  test('real namespace-import calls still get module argument checks', async () => {
    const ds = await diags(
      "import * as fs from 'fs';\n" +
      'print(fs.open(1), "\\n");\n');
    expect(byCode(ds, 'UC2004').length).toBeGreaterThan(0);
  });
});

describe('post-traversal function-fixpoint bugs', () => {
  // #7 narrowFunctionReturnType: iterating ALL functions (incl. nested) after
  // traversal, a nested `function halt()` resolved the OUTER halt symbol and
  // overwrote its return type. The outer halt() returns 1 (integer).
  test('nested same-name function does not overwrite the outer return type', async () => {
    const code =
      'function halt() { return 1; }\n' +
      'function wrap() {\n' +
      '    function halt() { return "s"; }\n' +
      '    return halt();\n' +
      '}\n' +
      'let r = halt();\n' +
      'print(r, wrap(), "\\n");\n';
    const h = await server.getHover(code, '/tmp/ssl-ret.uc', 5, 4); // `r`
    const text = JSON.stringify(h?.contents ?? '');
    expect(text).toContain('integer');
    expect(text).not.toContain('string');
  });
});

describe('post-analysis hover/completion bugs', () => {
  // #3 hover.ts from-as-io early return: an unpositioned lookup('from') matched the
  // module-level io import for a function-local `let from`.
  test('hover on a local `let from` is the local, not io module docs', async () => {
    const code =
      "import { from } from 'io';\n" +
      'function f() {\n' +
      '    let from = 42;\n' +
      '    return from;\n' +
      '}\n' +
      'print(f(), from, "\\n");\n';
    const h = await server.getHover(code, '/tmp/ssl-from.uc', 3, 12);
    const text = JSON.stringify(h?.contents ?? '');
    expect(text).toContain('integer');
    expect(text).not.toContain('io.handle');
  });

  // ...and the real io `from` still hovers as the module function.
  test('hover on the real io from still shows module docs', async () => {
    const code = "import { from } from 'io';\nprint(from, \"\\n\");\n";
    const h = await server.getHover(code, '/tmp/ssl-from2.uc', 1, 7);
    expect(JSON.stringify(h?.contents ?? '')).toContain('io.handle');
  });

  // #4 completion.ts: five member-completion helpers dropped the offset, so a
  // function-local `const c = nl.const` produced ZERO constant completions while
  // the identical module-level code produced all 178.
  test('nl.const alias inside a function still completes the constants', async () => {
    const code =
      "import * as nl from 'nl80211';\n" +
      'function g() {\n' +
      '    const c = nl.const;\n' +
      '    c.\n' +
      '}\n';
    const c = await server.getCompletions(code, '/tmp/ssl-nlc.uc', 3, 6);
    const items = (Array.isArray(c) ? c : c?.items) ?? [];
    expect(items.some(i => /^NL80211_/.test(i.label))).toBe(true);
  });
});
