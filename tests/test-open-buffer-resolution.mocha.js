// Cross-file resolution must use the OPEN editor buffer (unsaved content), not
// stale on-disk content. Here the imported file's disk version differs from the
// version "open" in the editor; completion, hover, and go-to-definition from
// another file should all reflect the buffer.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Open-buffer cross-file resolution (e2e)', function () {
  this.timeout(20000);

  let server;
  let root;
  let lib;

  const posAt = (code, idx) => {
    const pre = code.slice(0, idx);
    return { line: (pre.match(/\n/g) || []).length, character: idx - (pre.lastIndexOf('\n') + 1) };
  };
  const labelsOf = (r) => (Array.isArray(r) ? r : (r && r.items) || []).map((i) => i.label);

  before(async function () {
    server = createLSPTestServer();
    await server.initialize();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-buf-'));
    lib = path.join(root, 'lib.uc');

    // Disk has the OLD version...
    fs.writeFileSync(lib, 'export function diskOnly() {}\n');
    // ...but the editor has an unsaved NEW version (two blank lines push the def to L2).
    const bufferContent = '\n\nexport function bufferNew(x) {\n  return x;\n};\n';
    await server.getHover(bufferContent, lib, 2, 18); // didOpen lib.uc with buffer content
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  it('completion sees the unsaved buffer exports of an imported file', async () => {
    const code = "import * as mod from './lib.uc';\nmod.\n";
    const fp = path.join(root, 'app.uc');
    fs.writeFileSync(fp, code);
    const p = posAt(code, code.indexOf('mod.') + 4);
    const labels = labelsOf(await server.getCompletions(code, fp, p.line, p.character));
    assert.ok(labels.includes('bufferNew'), `expected unsaved export bufferNew, got ${JSON.stringify(labels)}`);
    assert.ok(!labels.includes('diskOnly'), `stale disk export diskOnly should not appear, got ${JSON.stringify(labels)}`);
  });

  it('go-to-definition lands on the buffer line, not the disk line', async () => {
    const code = "import { bufferNew } from './lib.uc';\nbufferNew(1);\n";
    const fp = path.join(root, 'app2.uc');
    fs.writeFileSync(fp, code);
    const p = posAt(code, code.indexOf('bufferNew(1'));
    const def = await server.getDefinition(code, fp, p.line, p.character);
    assert.ok(def, 'expected a cross-file definition');
    assert.ok(def.uri.endsWith('/lib.uc'), `expected lib.uc, got ${def.uri}`);
    assert.strictEqual(def.range.start.line, 2, 'should map to the buffer line (2), not the disk line (0)');
  });
});
