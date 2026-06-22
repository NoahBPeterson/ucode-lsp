// SERVER-DRIVEN coverage for shebang.ts — extensionless ucode scripts detected by a
// `#!… ucode` shebang. The init workspace scan exercises the ASYNC path
// (isUcodeSourceFileAsync) over a fixture tree; a watched-file Create exercises the
// SYNC path (isUcodeSourceFile) and proves the file is picked up + analyzed.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'shebang-'));
const W = (name, content) => fs.writeFileSync(path.join(ws, name), content);
// Mix of detection cases (scanned on init -> async peek path):
W('script_ucode', `#!/usr/bin/ucode\nfunction shebang_scanned() { return 1; }\n`);
W('script_env', `#!/usr/bin/env ucode\nlet envScript = 1;\n`);
W('script_flags', `#!/usr/bin/ucode -R\nlet rawScript = 2;\n`);
W('script_bash', `#!/bin/bash\necho hello\n`);            // NOT ucode
W('config.json', `{ "a": 1 }\n`);                          // has extension -> skipped
W('regular.uc', `function plain() { return 0; }\n`);       // detected by extension

describe('shebang detection coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer({ workspaceRoot: ws }); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  it('analyzes an extensionless ucode-shebang file created at runtime (sync path)', async () => {
    const name = 'script_created';
    const uri = `file://${path.join(ws, name)}`;
    fs.writeFileSync(path.join(ws, name), `#!/usr/bin/ucode\nlet created = undefinedThing;\n`);
    s.notifyWatchedFileChange(uri, 1 /* Created */);
    // The server should recognise it as ucode and publish diagnostics for it.
    const ds = await s.waitForDiagnostics(uri, () => true, 5000)
      .catch(() => { throw new Error('shebang-ucode file was not detected/analyzed on create'); });
    assert.ok(Array.isArray(ds), 'created shebang ucode file is analyzed');
  });

  it('does NOT treat a non-ucode shebang file as ucode', async () => {
    const uri = `file://${path.join(ws, 'script_bash_new')}`;
    fs.writeFileSync(path.join(ws, 'script_bash_new'), `#!/bin/bash\necho hi\n`);
    s.notifyWatchedFileChange(uri, 1 /* Created */);
    // No ucode diagnostics should ever arrive for a bash script. Give it a moment;
    // if nothing comes, that's the expected outcome.
    let analyzed = false;
    await s.waitForDiagnostics(uri, () => true, 1200).then(() => { analyzed = true; }).catch(() => {});
    assert.strictEqual(analyzed, false, 'a #!/bin/bash file must not be analyzed as ucode');
  });

  it('finds symbols from a scanned shebang-ucode script via workspace symbols', async () => {
    // Best-effort (scan is async): retry the workspace-symbol query briefly.
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const syms = await s.getWorkspaceSymbols(`let probe = 1;\n`, path.join(ws, 'probe.uc'), 'shebang_scanned').catch(() => []);
      found = Array.isArray(syms) && syms.some(x => x && x.name === 'shebang_scanned');
      if (!found) await new Promise(r => setTimeout(r, 300));
    }
    assert.ok(found, 'function from an extensionless #!/usr/bin/ucode script should be a workspace symbol');
  });
});
