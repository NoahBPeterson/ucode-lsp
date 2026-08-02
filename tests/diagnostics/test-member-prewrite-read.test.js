// A member READ that executes BEFORE any write to that member must not be typed
// with the FUTURE write's type. docs/uc2009-member-prewrite-read-fallback.md
// (member twin of the 0.7.81 identifier fix; glinet firewall.uc:523-527)
//
// Root cause: propertyTypeAt's read-precedes-all-writes fallbacks (earliest.type,
// then the flat propertyTypes map) both hand a later assignment's type to an
// earlier read. All FP repros here are runtime-verified: every "always false"
// branch actually executes.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/mpw-${n++}.uc`)) || [];
const uc2009 = (ds) => ds.filter(d => d.code === 'UC2009');

describe('pre-write member reads must not use a future write type (UC2009 FPs)', () => {
  test('the firewall.uc normalization ladder (string in, array out)', async () => {
    const ds = await diags(
      'function normalize(param) {\n' +
      '    if (param.proto == "tcp udp") param.proto = ["tcp", "udp"];\n' +
      '    else if (param.proto == "tcp") param.proto = ["tcp"];\n' +
      '    else if (param.proto == "") param.proto = ["all"];\n' +
      '    return param.proto;\n' +
      '}\n' +
      'print(normalize({ proto: "tcp" }), "\\n");\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('minimal trigger: one later write', async () => {
    const ds = await diags(
      'function f(p) {\n' +
      '    if (p.x == "a") p.x = [1];\n' +
      '    return p.x;\n' +
      '}\n' +
      'print(f({ x: "a" }), "\\n");\n');
    expect(uc2009(ds)).toEqual([]);
  });

  test('declared object literal: pre-write read is the DECLARED type, not the future one', async () => {
    // o.x is the string "a" when tested; the array assignment happens after.
    const ds = await diags(
      'let o = { x: "a" };\n' +
      'if (o.x == "a") o.x = [1];\n' +
      'print(o.x, "\\n");\n');
    expect(uc2009(ds)).toEqual([]);
  });
});

describe('post-ladder reads stay honest about the fall-through path', () => {
  test('after conditional-only writes, the read is written-type | unknown, not definite', async () => {
    // A null or integer proto matches NO branch (null == "" is false in ucode),
    // so param.proto flows to the return unchanged - the type must keep the
    // fall-through possibility, not claim a definite array<string>.
    const code =
      'function normalize(param) {\n' +
      '    if (param.proto == "tcp udp") param.proto = ["tcp", "udp"];\n' +
      '    else if (param.proto == "tcp") param.proto = ["tcp"];\n' +
      '    return param.proto;\n' +
      '}\n' +
      'print(normalize({ proto: 7 }), "\\n");\n';
    const h = await server.getHover(code, '/tmp/mpw-post2.uc', 3, 18);
    const text = JSON.stringify(h?.contents ?? '');
    expect(text).toContain('array');
    expect(text).toContain('unknown');
  });
});

describe('the type-normalization guard idiom stays precise', () => {
  test('write under `if (type(x.p) != "string")` makes the post-if read string, not | unknown', async () => {
    // Both paths end with args.lang a string (it was one, or it just became "en"),
    // so match(args.lang, ...) must NOT warn "may be unknown". (glinet ui.uc:62-66)
    const ds = await diags(
      'function f(args) {\n' +
      '    if (type(args.lang) != "string")\n' +
      '        args.lang = "en";\n' +
      '    return match(args.lang, /^[a-zA-Z-]+$/) ? args.lang : "en";\n' +
      '}\n' +
      'print(f({ lang: "de" }), "\\n");\n');
    expect(ds.filter(d => /may be unknown/.test(d.message))).toEqual([]);
  });
});

describe('what must keep working', () => {
  test('true positive: read AFTER a real write still fires', async () => {
    // p.x really is [1] at the comparison - runtime proves the branch dead.
    const ds = await diags(
      'function f(p) {\n' +
      '    p.x = [1];\n' +
      '    if (p.x == "a") return 1;\n' +
      '    return 2;\n' +
      '}\n' +
      'print(f({ x: "a" }), "\\n");\n');
    expect(uc2009(ds).length).toBe(1);
  });

  test('post-ladder reads still type as the written array', async () => {
    // After an unconditional write, indexing with a bogus string key on the array
    // path is unaffected; assert via hover that the final read is array-typed.
    const code =
      'function f(p) {\n' +
      '    p.proto = ["tcp"];\n' +
      '    return p.proto;\n' +
      '}\n' +
      'print(f({}), "\\n");\n';
    const h = await server.getHover(code, '/tmp/mpw-post.uc', 2, 13);
    expect(JSON.stringify(h?.contents ?? '')).toContain('array');
  });

  test('declared literal type survives for reads between declaration and reassignment', async () => {
    const code =
      'let o = { x: "a" };\n' +
      'print(o.x, "\\n");\n' +
      'o.x = [1];\n' +
      'print(o.x, "\\n");\n';
    const h1 = await server.getHover(code, '/tmp/mpw-decl.uc', 1, 8);
    const h2 = await server.getHover(code, '/tmp/mpw-decl.uc', 3, 8);
    expect(JSON.stringify(h1?.contents ?? '')).toContain('string');
    expect(JSON.stringify(h2?.contents ?? '')).toContain('array');
  });
});
