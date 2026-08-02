// Block-scoped `let` named after a builtin must shadow the builtin in the
// comparison lint, exactly as it does in real ucode and in hover.
// docs/foreach-callback-local-builtin-shadow.md
//
// Bug: visitIfStatement re-checks the whole statement AFTER the branch block's
// scope has exited; checkIdentifier's plain lookup() missed the block-scoped
// local and fell back to the builtin registry, typing `proto` as `function`
// and raising UC2009 "a value of type `function` can never be ..." on code
// that runs fine (oracle-verified: the comparison operates on the local).

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/bshadow-${n++}.uc`)) || [];
const uc2009 = (ds) => ds.filter(d => d.code === 'UC2009');

describe('block-scoped locals named after builtins shadow the builtin (UC2009 FPs)', () => {
  test('minimal repro: let proto in a top-level if-block, then compared', async () => {
    const ds = await diags(
      'if (true) {\n' +
      '    let proto = sprintf("%d", 1);\n' +
      '    if (proto != "dhcpv6")\n' +
      '        print(proto, "\\n");\n' +
      '}\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('glinet lan.uc shape: let proto in an if-block inside a foreach callback', async () => {
    const ds = await diags(
      'let sections = [{ ".name": "modem_5g", proto: "qmi" }];\n' +
      'map(sections, function (s) {\n' +
      '    let name = s[".name"];\n' +
      '    if (substr(name, 0, 6) == "modem_") {\n' +
      '        let proto = s.proto;\n' +
      '        if (proto && proto != "dhcpv6") {\n' +
      '            if (proto == "qcm" || proto == "qmi") print(proto, "_4\\n");\n' +
      '            else print(proto, "\\n");\n' +
      '        }\n' +
      '    }\n' +
      '});\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('other builtin names too: let index in an if-block', async () => {
    const ds = await diags(
      'if (true) {\n' +
      '    let index = sprintf("%d", 1);\n' +
      '    if (index != "dhcpv6") print(index, "\\n");\n' +
      '}\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('else-branch block is the same scope shape', async () => {
    const ds = await diags(
      'if (false) print("no\\n");\n' +
      'else {\n' +
      '    let proto = sprintf("%d", 1);\n' +
      '    if (proto != "dhcpv6") print(proto, "\\n");\n' +
      '}\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('plain-expression comparison inside the if-block (not just if-conditions)', async () => {
    const ds = await diags(
      'if (true) {\n' +
      '    let proto = sprintf("%d", 1);\n' +
      '    let y = proto != "dhcpv6";\n' +
      '    print(y, "\\n");\n' +
      '}\n');
    expect(uc2009(ds)).toEqual([]);
  });
});

describe('controls: what already worked must keep working', () => {
  test('flat let proto directly in a callback body stays clean', async () => {
    const ds = await diags(
      'map([1, 2], function (s) {\n' +
      '    let proto = sprintf("%d", s);\n' +
      '    if (proto != "dhcpv6") print(proto, "\\n");\n' +
      '});\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('non-builtin name in the same nesting stays clean', async () => {
    const ds = await diags(
      'if (true) {\n' +
      '    let myvar = sprintf("%d", 1);\n' +
      '    if (myvar != "dhcpv6") print(myvar, "\\n");\n' +
      '}\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('a genuine builtin comparison (no local declaration) still fires', async () => {
    const ds = await diags('if (proto == "dhcpv6") print(1, "\\n");\n');
    const hits = uc2009(ds);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain('function');
  });

  test('true positive on a builtin-named local: ONE diagnostic with the LOCAL type', async () => {
    // Before the fix this emitted TWO UC2009s at the same spot: `array` (the
    // in-scope pass, correct) and `function` (the stale re-check, wrong).
    const ds = await diags(
      'if (true) {\n' +
      '    let proto = [];\n' +
      '    if (proto == "s") print(1, "\\n");\n' +
      '}\n');
    const hits = uc2009(ds);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain('array');
    expect(hits[0].message).not.toContain('function');
  });
});
