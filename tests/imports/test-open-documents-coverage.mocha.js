// SERVER-DRIVEN coverage for analysis/openDocuments.ts — the open-buffer registry that
// makes cross-file resolution use the UNSAVED editor content instead of stale disk.
// Exercises setOpenDocumentContent (on open/change) + getOpenDocumentContent (used by
// the file resolver): an importer must see the dependency's OPEN buffer, not its disk.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'opendocs-'));
const uri = (n) => `file://${path.join(ws, n)}`;
const codes = (ds) => ds.map(d => d.code);

describe('openDocuments (open-buffer) coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer({ workspaceRoot: ws }); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  it('importer resolves a dependency via its UNSAVED open buffer, not disk', async () => {
    // Disk lacks `fromBuffer`; the open buffer provides it.
    fs.writeFileSync(path.join(ws, 'lib.uc'), `export function onDisk() { return 1; }\n`);
    const buffer = `export function onDisk() { return 1; }\nexport function fromBuffer() { return 2; }\n`;
    s.openOrChangeDocument(uri('lib.uc'), buffer, 1); // registers the open buffer (setOpenDocumentContent)

    const app = `import { fromBuffer } from './lib.uc';\nlet r = fromBuffer();\n`;
    const ds = await s.getDiagnostics(app, path.join(ws, 'appA.uc'));
    const notExported = ds.filter(d => /does not export|not exported/i.test(d.message) && /fromBuffer/.test(d.message));
    assert.strictEqual(notExported.length, 0,
      `importer should see 'fromBuffer' from the open buffer, got: ${JSON.stringify(ds.map(d => d.message))}`);
  });

  it('editing the open buffer is reflected in the importer (getOpenDocumentContent is live)', async () => {
    // Now change the open buffer to REMOVE fromBuffer -> importer should flag it.
    s.openOrChangeDocument(uri('lib.uc'), `export function onDisk() { return 1; }\n`, 2);
    const app = `import { fromBuffer } from './lib.uc';\nfromBuffer();\n`;
    const ds = await s.getDiagnostics(app, path.join(ws, 'appB.uc'));
    const flagged = ds.some(d => /fromBuffer/.test(d.message) && /export/i.test(d.message));
    assert.ok(flagged, `after removing it from the buffer, importer should flag 'fromBuffer', got: ${JSON.stringify(ds.map(d => d.message))}`);
  });

  it('closing the dependency drops its open buffer (clearOpenDocumentContent), falling back to disk', async () => {
    // Disk has only onDisk; open buffer adds fromBuffer.
    fs.writeFileSync(path.join(ws, 'dep.uc'), `export function onDisk() { return 1; }\n`);
    s.openOrChangeDocument(uri('dep.uc'), `export function onDisk() { return 1; }\nexport function fromBuffer() { return 2; }\n`, 1);
    // While open, importer sees fromBuffer (no error).
    const open = await s.getDiagnostics(`import { fromBuffer } from './dep.uc';\nfromBuffer();\n`, path.join(ws, 'appOpen.uc'));
    assert.ok(!open.some(d => /fromBuffer/.test(d.message) && /export/i.test(d.message)), 'open buffer provides fromBuffer');
    // Close dep -> buffer dropped -> importer now resolves via disk (no fromBuffer) -> flagged.
    s.closeDocument(uri('dep.uc'));
    const closed = await s.getDiagnostics(`import { fromBuffer } from './dep.uc';\nfromBuffer();\n`, path.join(ws, 'appClosed.uc'));
    const flagged = closed.some(d => /fromBuffer/.test(d.message) && /export/i.test(d.message));
    assert.ok(flagged, `after closing dep, disk fallback must flag 'fromBuffer', got: ${JSON.stringify(closed.map(d => d.message))}`);
  });
});
