// Regression: when the server receives workspace/didChangeConfiguration after
// `ucode.targetVersion` changes, it must re-analyze open documents so version-gated
// diagnostics (UC6005) update immediately — in BOTH directions, with no file edit.
//
// This pins the SERVER half. The actual user-facing bug was on the CLIENT:
// extension.ts didn't set `synchronize.configurationSection: 'ucode'`, so VS Code
// never sent didChangeConfiguration when the setting changed and the (working) server
// handler never fired. That client wiring can't be exercised without a VS Code
// instance; this test drives the notification directly to guard the server path.
// (Version gates fire in the always-run scope pass, so incremental re-analysis
// re-evaluates them correctly — no forceFull needed.)
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('targetVersion change re-analyzes open documents (UC6005)', function () {
  this.timeout(20000);
  let s, ws;
  before(async () => {
    // Dedicated server (workspaceRoot bypasses the shared wrapper) with a tiny temp
    // workspace so the scan is cheap, and an injected mutable `ucode` config.
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-reanalyze-'));
    s = createLSPTestServer({
      workspaceRoot: ws,
      // Advertise workspace/configuration so the server reads (and re-reads) targetVersion.
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      configuration: { ucode: { targetVersion: '25.12' } },
    });
    await s.initialize();
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  const u6005 = (ds) => ds.filter(d => d.code === 'UC6005').length;

  it('flips UC6005 on/off as the target changes, with no edit to the file', async () => {
    const uri = `file://${path.join(ws, 'tv.uc')}`;
    // The gated usage is INSIDE a function body (fs.mkdtemp is a 25.12-only fs
    // function). This is the case that exercises the bug: the incremental cache skips
    // unchanged function bodies, so a config-change re-validate without forceFull
    // replays the body's stale diagnostics. (A top-level import always re-analyzes,
    // so it would NOT catch the regression.)
    const code = "import * as fs from 'fs';\nfunction f() {\n  return fs.mkdtemp('/tmp/x');\n}\n";

    // 1) Open at 25.12 → fs.mkdtemp is available, no version gate.
    s.openOrChangeDocument(uri, code);
    let ds = await s.waitForDiagnostics(uri, (d) => Array.isArray(d), 8000);
    assert.strictEqual(u6005(ds), 0, '25.12: fs.mkdtemp should NOT be version-gated');

    // 2) Switch target to 24.10 (NO file edit) → UC6005 must appear. Before the fix the
    //    incremental cache skipped f()'s unchanged body and replayed the ungated result.
    s.notifyConfigChange({ targetVersion: '24.10' });
    ds = await s.waitForDiagnostics(uri, (d) => u6005(d) >= 1, 8000);
    assert.ok(u6005(ds) >= 1, '24.10: fs.mkdtemp (25.12-only) must be flagged UC6005 after the change');

    // 3) Switch back to 25.12 → UC6005 must clear again.
    s.notifyConfigChange({ targetVersion: '25.12' });
    ds = await s.waitForDiagnostics(uri, (d) => u6005(d) === 0, 8000);
    assert.strictEqual(u6005(ds), 0, '25.12: UC6005 must clear after switching back');
  });
});
