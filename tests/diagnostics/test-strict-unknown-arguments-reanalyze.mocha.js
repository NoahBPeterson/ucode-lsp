// End-to-end SERVER coverage for `ucode.strictUnknownArguments` (default true).
// Pins the config path the analyzer-level test can't: the server reads the setting via
// workspace/configuration, and a didChangeConfiguration must RE-ANALYZE open documents so
// the severity flips with no file edit. A pure-unknown builtin arg under 'use strict' is an
// ERROR with the setting on and a WARNING with it off; proven mismatches/possibly-null stay
// errors regardless (governed elsewhere). Mirrors test-target-version-reanalyze.mocha.js.
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('strictUnknownArguments change re-analyzes open documents', function () {
  this.timeout(20000);
  let s, ws;
  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sua-reanalyze-'));
    s = createLSPTestServer({
      workspaceRoot: ws,
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      configuration: { ucode: { strictUnknownArguments: true } }, // default
    });
    await s.initialize();
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  // The unknown-arg diagnostic on the substr() call. `p` is an unannotated param → unknown.
  const code = "'use strict';\nfunction f(p) {\n  return substr(p, 0, 1);\n}\n";
  const unknownArg = (ds) => ds.filter(d => /is unknown\. Use a type guard/.test(d.message));
  const errs = (ds) => unknownArg(ds).filter(d => d.severity === 1);
  const warns = (ds) => unknownArg(ds).filter(d => d.severity === 2);

  it('flips the unknown-arg severity error<->warning as the setting changes, with no edit', async () => {
    const uri = `file://${path.join(ws, 'sua.uc')}`;

    // 1) Open with the default (true) → the unknown arg is an ERROR.
    s.openOrChangeDocument(uri, code);
    let ds = await s.waitForDiagnostics(uri, (d) => unknownArg(d).length >= 1, 8000);
    assert.strictEqual(errs(ds).length, 1, 'default(true): unknown arg should be an ERROR');
    assert.strictEqual(warns(ds).length, 0, 'default(true): not a warning');

    // 2) Turn the setting OFF (no file edit) → same diagnostic becomes a WARNING.
    s.notifyConfigChange({ strictUnknownArguments: false });
    ds = await s.waitForDiagnostics(uri, (d) => warns(d).length >= 1, 8000);
    assert.strictEqual(warns(ds).length, 1, 'off: unknown arg must downgrade to a WARNING');
    assert.strictEqual(errs(ds).length, 0, 'off: no error remains');

    // 3) Turn it back ON → error again.
    s.notifyConfigChange({ strictUnknownArguments: true });
    ds = await s.waitForDiagnostics(uri, (d) => errs(d).length >= 1, 8000);
    assert.strictEqual(errs(ds).length, 1, 'on again: unknown arg must be an ERROR again');
  });
});
