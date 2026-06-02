const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Dot member access on a scalar primitive (string/int/double/bool) is a hard
// runtime reference error in ucode ("left-hand side is not an array or object").
// The existing check caught CONCRETE strings; this verifies it now also covers
// (a) values NARROWED to a scalar by a guard, and (b) int/double/bool — while
// staying sound (bail on unknown/object/handle/computed access).
describe('Scalar member-access JS-ism (UC5001)', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/scalar-member.uc';
  const memberErrs = async (code) =>
    (await getDiagnostics(code, FP)).filter(d => /does not exist on|not objects/i.test(d.message || ''));

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  // ── the headline gap: a value narrowed to string by a guard ─────────────────
  it('flags `.startsWith` on a value narrowed to string by an early-exit continue', async () => {
    const code = `function f(arr) {
      for (let i = 0; i < length(arr); i++) {
        let v = arr[i];
        if (type(v) != "string") continue;
        if (v.startsWith("w")) print(v);
      }
    }`;
    const ds = await memberErrs(code);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /startsWith.*string/);
  });

  it('flags `.startsWith` on a param narrowed to string by an early-exit return', async () => {
    assert.strictEqual((await memberErrs(`function f(x) { if (type(x) != "string") return; return x.startsWith("a"); }`)).length, 1);
  });

  // ── concrete scalars (string already worked; int/double/bool are new) ───────
  it('flags member access on a concrete string (regression)', async () => {
    assert.strictEqual((await memberErrs(`let s = "hi"; let n = s.length;`)).length, 1);
  });

  it('flags member access on integer / double / boolean / function', async () => {
    assert.strictEqual((await memberErrs(`let n = 5; let x = n.toFixed;`)).length, 1);
    assert.strictEqual((await memberErrs(`let d = 3.14; let x = d.foo;`)).length, 1);
    assert.strictEqual((await memberErrs(`let b = true; let x = b.foo;`)).length, 1);
    assert.strictEqual((await memberErrs(`let fn = () => 1; let x = fn.prop;`)).length, 1); // functions are not objects in ucode
  });

  it('includes a JS→ucode hint for common string members', async () => {
    assert.match((await memberErrs(`let s = "hi"; let u = s.toUpperCase();`))[0].message, /uc\(x\)/);
    assert.match((await memberErrs(`let s = "hi"; let n = s.length;`))[0].message, /length\(x\)/);
  });

  // ── soundness ───────────────────────────────────────────────────────────────
  it('does NOT flag member access on an object, handle, or unknown value', async () => {
    assert.strictEqual((await memberErrs(`let o = { x: 1 }; let v = o.x;`)).length, 0);
    assert.strictEqual((await memberErrs(`import * as fs from 'fs'; let f = fs.open("/x","r"); let t = f.tell();`)).length, 0);
    assert.strictEqual((await memberErrs(`function f(x) { return x.startsWith("a"); }`)).length, 0); // unknown param
  });

  it('does NOT flag computed/index access on a string (`s[0]`)', async () => {
    assert.strictEqual((await memberErrs(`let s = "hi"; let c = s[0];`)).length, 0);
  });
});
