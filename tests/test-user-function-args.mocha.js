const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Call-site argument checking for in-file user functions with a known signature
// (JSDoc @param types + arity). ucode imposes no runtime arity/type constraint on
// user calls (missing→null, extra→ignored, dynamic types), so these are all
// WARNINGS, escalated to errors only under 'use strict'. Sound by construction:
// bail on unknown arg/param types; too-many only on non-variadic; too-few only
// for declared non-optional params.
describe('User-function call argument checking', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics, getCodeActions;
  const FP = '/tmp/user-fn-args.uc';
  const argDiags = async (code) =>
    (await getDiagnostics(code, FP)).filter(d =>
      /expects|provided|ignored|passes null|argument/i.test(d.message || ''));

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getCodeActions = lspServer.getCodeActions;
  });
  after(function () { if (lspServer) lspServer.shutdown(); });

  const D = `/** @param {string} name */\nfunction foo(name) { return name; }\n`;
  const AB = `/** @param {string} a\n * @param {string} b */\nfunction foo(a,b) { return a; }\n`;

  // ── argument TYPE checking ──────────────────────────────────────────────────
  it('flags a wrong-type literal argument', async () => {
    const ds = await argDiags(`${D}foo(123);`);
    assert.strictEqual(ds.length, 1);
    assert.strictEqual(ds[0].code, 'incompatible-function-argument');
    assert.match(ds[0].message, /string/);
  });

  it('flags an array passed where a string is expected', async () => {
    assert.strictEqual((await argDiags(`${D}foo([1,2]);`)).length, 1);
  });

  it('flags a wrong-type argument passed via a variable', async () => {
    assert.strictEqual((await argDiags(`${D}let n = 123; foo(n);`)).length, 1);
  });

  it('does NOT flag a correct argument', async () => {
    assert.strictEqual((await argDiags(`${D}foo("hi");`)).length, 0);
  });

  it('does NOT flag an unknown-typed argument (bail on unknown — not confident)', async () => {
    // `x` is an un-annotated param → unknown → could be a string at runtime.
    assert.strictEqual((await argDiags(`${D}function w(x) { return foo(x); }`)).length, 0);
  });

  it('does NOT flag calls to an UN-annotated function (no contract → no type check)', async () => {
    assert.strictEqual((await argDiags(`function bar(a) { return a; }\nbar(123);`)).length, 0);
  });

  // ── arity ───────────────────────────────────────────────────────────────────
  it('flags too many arguments to a non-variadic function', async () => {
    const ds = await argDiags(`${D}foo("x", "y");`);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /takes 1 argument but 2 were provided/);
  });

  it('does NOT flag extra arguments to a variadic (...rest) function', async () => {
    assert.strictEqual((await argDiags(`/** @param {string} a */\nfunction r(a, ...rest) { return a; }\nr("x", 1, 2, 3);`)).length, 0);
  });

  it('flags too few arguments for a declared, non-optional param', async () => {
    const ds = await argDiags(`${AB}foo("x");`);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /expects argument 'b'.*passes null/);
  });

  it('does NOT flag too few when the missing param is un-annotated', async () => {
    assert.strictEqual((await argDiags(`function bar(a, b) { return a; }\nbar("x");`)).length, 0);
  });

  it('does NOT flag too few when the missing param is optional ([name] / {T|null})', async () => {
    assert.strictEqual((await argDiags(`/** @param {string} a\n * @param {string} [b] */\nfunction o(a,b){return a;}\no("x");`)).length, 0);
    assert.strictEqual((await argDiags(`/** @param {string} a\n * @param {string|null} b */\nfunction o2(a,b){return a;}\no2("x");`)).length, 0);
  });

  // ── soundness guards ─────────────────────────────────────────────────────────
  it('does NOT flag a call using a spread argument (count/positions unknowable)', async () => {
    assert.strictEqual((await argDiags(`${AB}let args = ["x","y"]; foo(...args);`)).length, 0);
  });

  it('does NOT flag a correct recursive self-call', async () => {
    assert.strictEqual((await argDiags(`/** @param {int} n */\nfunction fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }`)).length, 0);
  });

  // ── function-value aliasing (`let f = foo`) ─────────────────────────────────
  it('checks a call through a function-valued variable (`let f = foo; f(x)`)', async () => {
    assert.strictEqual((await argDiags(`${D}let f = foo;\nf(123);`)).length, 1);
    assert.strictEqual((await argDiags(`${D}let f = foo;\nf("hi");`)).length, 0);
  });

  it('propagates the signature through an alias chain (`let g = f`)', async () => {
    assert.strictEqual((await argDiags(`${D}let f = foo;\nlet g = f;\ng(123);`)).length, 1);
  });

  it('flags too-many through an alias', async () => {
    assert.match((await argDiags(`${D}let f = foo;\nf("a","b");`))[0].message, /takes 1 argument but 2/);
  });

  it('does NOT carry a signature when aliasing an un-annotated function', async () => {
    assert.strictEqual((await argDiags(`function bare(a) { return a; }\nlet f = bare;\nf(123);`)).length, 0);
  });

  it('does NOT impose a 0-arg signature from a forward declaration (mutual recursion)', async () => {
    // `function is_odd;` is a prototype with no param list — it must not make
    // `is_odd(n - 1)` look like too-many-args. The real definition supplies the signature.
    const code = `function is_odd;\nfunction is_even(n) { return n == 0 || is_odd(n - 1); }\nfunction is_odd(n) { return n != 0 && is_even(n - 1); }`;
    assert.strictEqual((await argDiags(code)).length, 0);
  });

  // ── severity model ───────────────────────────────────────────────────────────
  it('is a warning normally, an error under "use strict"', async () => {
    assert.strictEqual((await argDiags(`${D}foo(123);`))[0].severity, 2);
    assert.strictEqual((await argDiags(`'use strict';\n${D}foo(123);`))[0].severity, 1);
  });

  // ── builtin checking is unchanged (regression) ───────────────────────────────
  it('does not disturb builtin argument checking', async () => {
    assert.strictEqual((await argDiags(`let r = ord("A");`)).length, 0);
    assert.strictEqual((await argDiags(`let r = ord([1,2]);`)).length, 1);
  });

  // ── existing quick-fixes apply to the new diagnostic ─────────────────────────
  it('offers a quick-fix on a wrong-type user-function argument', async () => {
    const code = `${D}let n = 123; foo(n);`;
    const ds = (await getDiagnostics(code, FP)).filter(d => d.code === 'incompatible-function-argument');
    assert.strictEqual(ds.length, 1);
    const line = ds[0].range.start.line, ch = ds[0].range.start.character;
    const actions = await getCodeActions(FP, ds, line, ch);
    assert.ok((actions || []).length > 0, 'expected at least one quick-fix action');
  });
});
