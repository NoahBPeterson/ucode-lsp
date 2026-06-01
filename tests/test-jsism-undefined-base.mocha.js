const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// A member-expression base that doesn't resolve to any symbol is an undefined
// variable — even when the member expression is the callee of a call. This
// catches JavaScript-isms ucode lacks (`Object.keys`, `Math.round`,
// `console.log`, `JSON.parse`) which previously slipped through because the
// call-callee exemption wrongly extended to the receiver.
describe('Undefined member-expression base (JS-isms)', function () {
  this.timeout(15000);

  let lspServer, getDiagnostics;
  const FP = '/tmp/jsism-base.uc';
  const uc1001 = async (code) =>
    (await getDiagnostics(code, FP)).filter(d => d.code === 'UC1001').map(d => d.message);

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
  });
  after(function () { if (lspServer) lspServer.shutdown(); });

  it('flags `Object.keys(...)` — Object is not a ucode global', async () => {
    assert.ok((await uc1001('let a = Object.keys({});')).some(m => /Object/.test(m)),
      'Object.keys should flag Object as undefined');
  });

  it('flags `Math.round(...)`', async () => {
    assert.ok((await uc1001('let a = Math.round(1.5);')).some(m => /Math/.test(m)),
      'Math.round should flag Math');
  });

  it('flags `console.log(...)`', async () => {
    assert.ok((await uc1001('console.log("x");')).some(m => /console/.test(m)),
      'console.log should flag console');
  });

  it('flags `JSON.parse(...)`', async () => {
    assert.ok((await uc1001('let a = JSON.parse("{}");')).some(m => /JSON/.test(m)),
      'JSON.parse should flag JSON');
  });

  it('flags the root of a chained undefined call `a.b.c()` exactly once', async () => {
    const ms = await uc1001('undefinedRoot.b.c();');
    assert.strictEqual(ms.filter(m => /undefinedRoot/.test(m)).length, 1, `got: ${JSON.stringify(ms)}`);
  });

  it('still flags a non-called member base `bar.baz` (unchanged)', async () => {
    assert.ok((await uc1001('let c = bar.baz;')).some(m => /bar/.test(m)));
  });

  // ── No false positives ─────────────────────────────────────────────────

  it('does NOT flag a defined local receiver', async () => {
    assert.deepStrictEqual(await uc1001('let o = {}; o.foo();'), []);
  });

  it('does NOT flag a parameter receiver', async () => {
    assert.deepStrictEqual(await uc1001('function f(p) { return p.bar(); }'), []);
  });

  it('does NOT flag an imported namespace receiver', async () => {
    assert.deepStrictEqual(await uc1001("import * as fs from 'fs';\nfs.open('/x', 'r');"), []);
  });

  it('does NOT emit UC1001 for an UNIMPORTED known module (validateModuleMember reports it specifically)', async () => {
    // The specific "Cannot use 'fs' module without importing it first" message is
    // emitted elsewhere; the generic UC1001 must not double up.
    assert.deepStrictEqual(await uc1001("fs.open('/x', 'r');"), []);
  });

  it('does NOT flag `this.x` inside a method', async () => {
    assert.deepStrictEqual(await uc1001('let o = { m: function() { return this.x; } };'), []);
  });
});
