// docs/self-reference-in-own-initializer.md: referencing a let/const variable
// from inside its OWN initializer — directly, through a closure body, a member
// base, or a write — is a compile-time rejection on EVERY ucode version
// ("Can't access lexical declaration 'x' before initialization"). The file
// never runs. Every error/clean verdict here is oracle-verified against both
// /usr/local/bin/ucode and ucode/build/ucode (master).

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/selfref-${n++}.uc`)) || [];
const selfRefs = (ds) => ds.filter(d => d.code === 'UC1012');

describe('self-reference in own initializer is a compile-time error', () => {
  test('anonymous self-recursion through the declaring variable', async () => {
    const ds = await diags(
      'let f = function (n) { return n < 2 ? 1 : n * f(n - 1); };\n' +
      'print(f(5), "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
    expect(selfRefs(ds)[0].severity).toBe(1);
  });

  test('direct read: let x = x + 1', async () => {
    const ds = await diags('let x = x + 1;\nprint(x, "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('object-literal closure referencing the object being declared', async () => {
    // The common "methods table" idiom — ucode rejects it (compile-time TDZ).
    const ds = await diags(
      'let o = { cb: function () { return o.name; }, name: "z" };\n' +
      'print(o.cb(), "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('array-literal closure referencing the array being declared', async () => {
    const ds = await diags(
      'let arr = [ function () { return arr; } ];\n' +
      'print(type(arr[0]()), "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('second declarator referencing itself', async () => {
    const ds = await diags('let a = 1, b = b + 1;\nprint(a + b, "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('const with ?? does not escape the check (no short-circuit at compile time)', async () => {
    const ds = await diags('const c = c ?? 5;\nprint(c, "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('self-WRITE inside the initializer is rejected too', async () => {
    const ds = await diags('let f = function () { f = 1; };\nprint("ok", "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('inner block shadow: the reference binds to the INNER declaration', async () => {
    // `let g = 1; { let g = g + 1; }` — the RHS g is the inner g (TDZ), not the
    // outer one. Oracle-verified crash on both binaries.
    const ds = await diags('let g = 1;\n{\n    let g = g + 1;\n    print(g, "\\n");\n}\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('shadowing a BUILTIN name still self-references (innermost wins)', async () => {
    const ds = await diags('let print = print;\nprint("ok", "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });

  test('one diagnostic per declarator, not one per reference', async () => {
    const ds = await diags(
      'let f = function () { return f() + f() + f(); };\n' +
      'print(f(), "\\n");\n');
    expect(selfRefs(ds).length).toBe(1);
  });
});

describe('legitimate shapes stay clean', () => {
  test('a parameter of the initializer function shadows the name', async () => {
    const ds = await diags('let f = function (f) { return f + 1; };\nprint(f(1), "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });

  test('a local inside the initializer function shadows the name', async () => {
    const ds = await diags('let f = function () { let f = 7; return f; };\nprint(f(), "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });

  test('an object KEY spelled like the variable is not a reference', async () => {
    const ds = await diags('let t = { t: 1 };\nprint(t.t, "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });

  test('a member PROPERTY spelled like the variable is not a reference', async () => {
    const ds = await diags(
      'let cfg = { port: 22 };\n' +
      'let port = cfg.port;\n' +
      'print(port, "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });

  test('for-init self-read is accepted by ucode — stay silent', async () => {
    // Oracle-verified on both binaries: `for (let i = i; ...)` compiles and runs.
    const ds = await diags('for (let i = i; i < 1; i++) print(i);\nprint("done", "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });

  test('declare-before, assign-later callback stays clean (0.7.47 contract)', async () => {
    const ds = await diags(
      'let handler;\n' +
      'let runner = function () { return handler(); };\n' +
      'handler = function () { return 1; };\n' +
      'print(runner(), "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });

  test('NAMED funcexpr recursion uses its own name, not the variable', async () => {
    // fact ≠ f: no self-reference. (The named-funcexpr-below-main version gate
    // is a different diagnostic and may fire on old targets — not UC1012.)
    const ds = await diags(
      'let f = function fact(n) { return n < 2 ? 1 : n * fact(n - 1); };\n' +
      'print(f(5), "\\n");\n');
    expect(selfRefs(ds)).toEqual([]);
  });
});
