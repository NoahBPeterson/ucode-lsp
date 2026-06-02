const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// A variable declared without an initializer (`let c;` → null) and assigned
// separately (`c = fs.readfile(p);` → string|null) must use its SSA current type
// when a truthiness guard narrows it. Before, the guard computed removeNull from
// the DECLARED `null` → `unknown`, so `if (c) { split(trim(c), …) }` wrongly
// warned "argument is unknown / may be null" even though c is a non-null string
// inside the guard.
describe('Truthiness narrowing of a declare-then-assign variable', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/decl-assign.uc';
  const flagged = async (code) =>
    (await getDiagnostics(code, FP)).filter(d =>
      /is unknown|may be null|possibly 'null'|nullable|argument 1/i.test(d.message || ''));
  const BODY = ` if (c) { let l = split(trim(c), '\\n'); } }`;

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  it('narrows when assigned separately (`let c; c = fs.readfile(p); if (c) {...}`)', async () => {
    assert.strictEqual((await flagged(`import * as fs from 'fs';\nfunction f(p){ let c; c = fs.readfile(p);${BODY}`)).length, 0);
  });

  it('narrows when assigned inside a try (the repro)', async () => {
    assert.strictEqual((await flagged(`import * as fs from 'fs';\nfunction f(p){ let c; try { c = fs.readfile(p); } catch(e){ return false; }${BODY}`)).length, 0);
  });

  it('still narrows the direct-init form (regression)', async () => {
    assert.strictEqual((await flagged(`import * as fs from 'fs';\nfunction f(p){ let c = fs.readfile(p);${BODY}`)).length, 0);
  });

  it('still warns with no guard (control)', async () => {
    assert.ok((await flagged(`import * as fs from 'fs';\nfunction f(p){ let c; c = fs.readfile(p); let l = split(trim(c), '\\n'); }`)).length >= 1);
  });
});
