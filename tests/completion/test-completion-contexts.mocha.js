// End-to-end tests for the various completion contexts the server detects:
// JSDoc tags/types, destructured imports, module-name + file-path completion in
// import statements, and default-export object property completion. These cover
// the detect*/create* completion paths that were largely untested e2e.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Completion contexts (e2e)', function () {
  this.timeout(20000);

  let getCompletions;
  let root;

  function labelsOf(result) {
    const items = Array.isArray(result) ? result : (result && result.items) || [];
    return items.map((i) => i.label);
  }

  // Complete with the cursor placed immediately after `anchor` in `code`.
  async function complete(code, anchor, fileName = 'app.uc') {
    const fp = path.join(root, fileName);
    fs.writeFileSync(fp, code);
    const idx = code.indexOf(anchor) + anchor.length;
    const pre = code.slice(0, idx);
    const line = (pre.match(/\n/g) || []).length;
    const character = idx - (pre.lastIndexOf('\n') + 1);
    return labelsOf(await getCompletions(code, fp, line, character));
  }

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getCompletions = server.getCompletions;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-compctx-'));
    fs.writeFileSync(path.join(root, 'cfg.uc'), "export default {\n  host: '',\n  port: 0\n};\n");
    fs.writeFileSync(path.join(root, 'helper.uc'), 'export function h() {}\n');
    fs.writeFileSync(path.join(root, 'utils.uc'), 'export function u() {}\n');
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  it('completes JSDoc tags after @', async () => {
    const labels = await complete('/** @ */\nfunction f(x) {}\n', '/** @');
    for (const tag of ['param', 'returns']) {
      assert.ok(labels.includes(tag), `expected @${tag}, got ${JSON.stringify(labels)}`);
    }
  });

  it('completes JSDoc types inside @param {…}', async () => {
    const labels = await complete('/** @param {} */\nfunction f(x) {}\n', '@param {');
    for (const t of ['string', 'integer', 'object']) {
      assert.ok(labels.includes(t), `expected type ${t}, got ${JSON.stringify(labels)}`);
    }
  });

  it('completes member names in a destructured import', async () => {
    const labels = await complete("import {  } from 'fs';\n", 'import { ');
    assert.ok(labels.includes('readfile'), `expected fs member readfile, got ${JSON.stringify(labels).slice(0, 120)}`);
    assert.ok(labels.includes('open'), `expected fs member open, got ${JSON.stringify(labels).slice(0, 120)}`);
  });

  it('completes module names in an import-from string', async () => {
    const labels = await complete("import * as x from '';\n", "from '");
    for (const m of ['fs', 'uci']) {
      assert.ok(labels.includes(m), `expected module ${m}, got ${JSON.stringify(labels)}`);
    }
  });

  it('completes relative file paths in an import-from string', async () => {
    const labels = await complete("import y from './';\n", "from './");
    assert.ok(labels.some((l) => l.includes('helper')), `expected helper.uc, got ${JSON.stringify(labels)}`);
    assert.ok(labels.some((l) => l.includes('utils')), `expected utils.uc, got ${JSON.stringify(labels)}`);
  });

  it('completes properties of a default-exported object', async () => {
    // binding 'config' is not a substring of './cfg.uc'
    const labels = await complete("import config from './cfg.uc';\nconfig.\n", 'config.');
    assert.ok(labels.includes('host') && labels.includes('port'), `expected host,port, got ${JSON.stringify(labels)}`);
  });
});
