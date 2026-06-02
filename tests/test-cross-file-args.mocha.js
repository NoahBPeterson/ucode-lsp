const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Phase 2 of user-function call-site checking: arguments to IMPORTED functions
// are checked against the param signature resolved from the *other* file
// (fileResolver.getNamedExportFunctionParameters / getDefaultExportFunctionParameters).
// The lib fixture (tests/fixtures/xref-args/lib.uc) exports greet(string, int),
// helper(string) via `export {}`, and a default fn(object).
describe('Cross-file user-function argument checking', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  // Consumer lives next to the fixture so `./lib.uc` resolves on disk.
  const CONS = path.join(__dirname, 'fixtures', 'xref-args', 'consumer.uc');
  const argDiags = async (code) =>
    (await getDiagnostics(code, CONS)).filter(d =>
      /argument|expects|expected|provided|ignored|passes null/i.test(d.message || ''));

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  // ── named import ────────────────────────────────────────────────────────────
  it('flags a wrong-type argument to an imported function', async () => {
    const ds = await argDiags(`import { greet } from './lib.uc';\ngreet(123, 5);`);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /string/);
  });

  it('does NOT flag a correct call to an imported function', async () => {
    assert.strictEqual((await argDiags(`import { greet } from './lib.uc';\ngreet("hi", 5);`)).length, 0);
  });

  it('flags too many / too few args cross-file', async () => {
    assert.match((await argDiags(`import { greet } from './lib.uc';\ngreet("hi", 5, 9);`))[0].message, /takes 2 arguments but 3/);
    assert.match((await argDiags(`import { greet } from './lib.uc';\ngreet("hi");`))[0].message, /expects argument 'count'/);
  });

  // ── aliased import + `export {}` form + default import ───────────────────────
  it('flags through an aliased import (`import { greet as g }`)', async () => {
    assert.strictEqual((await argDiags(`import { greet as g } from './lib.uc';\ng(123, 5);`)).length, 1);
  });

  it('flags a function exported via `export { helper }`', async () => {
    assert.strictEqual((await argDiags(`import { helper } from './lib.uc';\nhelper([1,2]);`)).length, 1);
  });

  it('flags a wrong-type arg to a DEFAULT-imported function', async () => {
    assert.strictEqual((await argDiags(`import lib from './lib.uc';\nlib(42);`)).length, 1);
    assert.strictEqual((await argDiags(`import lib from './lib.uc';\nlib({});`)).length, 0);
  });

  // ── soundness carries over ───────────────────────────────────────────────────
  it('does NOT flag an unknown-typed argument cross-file (bail on unknown)', async () => {
    assert.strictEqual((await argDiags(`import { greet } from './lib.uc';\nfunction w(x) { return greet(x, 1); }`)).length, 0);
  });

  it('is a warning normally, an error under "use strict"', async () => {
    assert.strictEqual((await argDiags(`import { greet } from './lib.uc';\ngreet(123, 5);`))[0].severity, 2);
    assert.strictEqual((await argDiags(`'use strict';\nimport { greet } from './lib.uc';\ngreet(123, 5);`))[0].severity, 1);
  });
});
