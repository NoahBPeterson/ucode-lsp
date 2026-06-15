const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Non-numeric UC2009 "impossible comparison" checks:
//  #1 type(x) == "<not a type() result>"  — closed-set string enum (JS-isms)
//  #2 <array/object/function/regexp value> == <scalar literal> — never equal
//  #3 a null-only value == <non-null scalar> — never equal
// All bounds/coercions verified against /usr/local/bin/ucode + the C source.
describe('Impossible non-numeric comparison (UC2009)', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics, getCodeActions;
  const FP = '/tmp/incompat-cmp.uc';
  const uc2009 = async (code) =>
    (await getDiagnostics(code, FP)).filter(d => d.code === 'UC2009');

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getCodeActions = lspServer.getCodeActions;
  });
  after(function () { if (lspServer) lspServer.shutdown(); });

  // ── #1: type() returns a closed set of strings ──────────────────────────────
  it('flags `type(x) == "number"` (no "number" type — it is int/double)', async () => {
    const ds = await uc2009(`let x = 1; let r = type(x) == "number";`);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /always false/);
    assert.match(ds[0].message, /"int" \/ "double"/);
  });

  it('flags the ucode-specific gotchas: "integer", "boolean", "regex"', async () => {
    assert.match((await uc2009(`let x=1; let r = type(x) == "integer";`))[0].message, /always false/);
    assert.match((await uc2009(`let x=1; let r = type(x) == "boolean";`))[0].message, /always false/);
    assert.match((await uc2009(`let x=1; let r = type(x) == "regex";`))[0].message, /always false/);
  });

  it('flags `type(x) != "undefined"` as always true, and handles the literal on the LEFT', async () => {
    assert.match((await uc2009(`let x=1; let r = type(x) != "undefined";`))[0].message, /always true/);
    assert.strictEqual((await uc2009(`let x=1; let r = "symbol" == type(x);`)).length, 1);
  });

  it('does NOT flag the real type() results (int/double/bool/string/array/object/function/regexp/resource)', async () => {
    for (const t of ['int','double','bool','string','array','object','function','regexp','resource']) {
      assert.strictEqual((await uc2009(`let x=1; let r = type(x) == "${t}";`)).length, 0, `type()=="${t}" should be allowed`);
    }
  });

  it('offers a quick-fix mapping the wrong string to the correct type name(s)', async () => {
    const mk = async (lit) => {
      const code = `let x=1; let r = type(x) == "${lit}";`;
      const ds = (await getDiagnostics(code, FP)).filter(d => d.code === 'UC2009');
      const actions = await getCodeActions(FP, ds, 0, 18);
      return (actions || []).filter(a => a.title.startsWith('Change to'))
        .map(a => a.edit.changes[`file://${FP}`][0].newText);
    };
    assert.deepStrictEqual(await mk('number'), ['"int"', '"double"']);
    assert.deepStrictEqual(await mk('boolean'), ['"bool"']);
    assert.deepStrictEqual(await mk('regex'), ['"regexp"']);
  });

  // ── #2: reference-type value vs scalar literal ──────────────────────────────
  it('flags an array value compared to a string/number literal', async () => {
    assert.match((await uc2009(`let a = [1,2]; let r = a == "foo";`))[0].message, /always false/);
    assert.match((await uc2009(`let a = [1,2]; let r = a != 0;`))[0].message, /always true/);
  });

  it('flags a builtin array return compared to a scalar (`split(s,x) == "foo"`)', async () => {
    assert.match((await uc2009(`let s="a,b"; let r = split(s, ",") == "foo";`))[0].message, /array.*never be == "foo"|always false/);
  });

  it('flags an object value compared to a scalar', async () => {
    assert.match((await uc2009(`let o = {}; let r = o == 0;`))[0].message, /always false/);
  });

  it('does NOT flag scalar-vs-scalar comparisons (they coerce)', async () => {
    assert.strictEqual((await uc2009(`let n = 5; let r = n == 0;`)).length, 0);
    assert.strictEqual((await uc2009(`let s = "x"; let r = s == "foo";`)).length, 0);
    assert.strictEqual((await uc2009(`let b = true; let r = b == 1;`)).length, 0);
  });

  it('does NOT flag an unknown-typed value (we are not confident)', async () => {
    assert.strictEqual((await uc2009(`function f(x) { return x == 0; }`)).length, 0);
  });

  // ── #3: null-only value vs a non-null scalar ────────────────────────────────
  it('does NOT flag the legitimate `value == null` null-check idiom', async () => {
    // We deliberately skip the null-LITERAL direction — defensive null checks are
    // idiomatic even when our inference thinks they are unnecessary.
    assert.strictEqual((await uc2009(`let a = [1]; let r = a == null;`)).length, 0);
  });

  it('is an Error regardless of strict mode (#106 — deterministic bug)', async () => {
    assert.strictEqual((await uc2009(`'use strict';\nlet x=1; let r = type(x) == "number";`))[0].severity, 1);
    assert.strictEqual((await uc2009(`let x=1; let r = type(x) == "number";`))[0].severity, 1);
  });
});
