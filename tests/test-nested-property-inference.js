// Test that nested property types are inferred through default import + member access.
// e.g., import _mod from 'mymod'; let info = _mod.info; info.name → string

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

function extractHoverText(hover) {
  if (!hover || !hover.contents) return '';
  const { contents } = hover;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(e => (typeof e === 'string' ? e : e.value || '')).join('\n');
  return contents.value || '';
}

// Module and test files live in the same directory so bare imports resolve
const tmpDir = path.join(__dirname, 'tmp-nested-prop-test');
const modFile = path.join(tmpDir, 'mymod.uc');
const testFile = path.join(tmpDir, '_test_consumer.uc');

describe('Nested Property Type Inference', function() {
  this.timeout(30000);

  let lspServer, getHover, getDiagnostics;

  before(async function() {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(modFile, `'use strict';
const info = {
  name: 'test-pkg',
  version: '1.0',
  count: 42,
  enabled: true,
  chains_list: 'forward output prerouting',
};

const sym = {
  ok: 'OK',
  fail: 'FAIL',
};

function helper() { return 'help'; }

export default { info, sym, helper };
`);

    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(async function() {
    if (lspServer) await lspServer.shutdown();
    try { fs.unlinkSync(modFile); fs.unlinkSync(testFile); fs.rmdirSync(tmpDir); } catch {}
  });

  it('should infer string type for nested property info.name', async function() {
    const lines = [
      "import _mod from 'mymod';",
      'let info = _mod.info;',
      'let name = info.name;',
      'print(name);',
    ];
    const code = lines.join('\n');
    const hover = await getHover(code, testFile, 2, 5);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('string'),
      `Expected 'string' for info.name, got: ${text}`);
  });

  it('should infer integer type for nested property info.count', async function() {
    const lines = [
      "import _mod from 'mymod';",
      'let info = _mod.info;',
      'let c = info.count;',
      'print(c);',
    ];
    const code = lines.join('\n');
    const hover = await getHover(code, testFile, 2, 4);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('integer'),
      `Expected 'integer' for info.count, got: ${text}`);
  });

  it('should infer string type for nested property sym.ok', async function() {
    const lines = [
      "import _mod from 'mymod';",
      'let sym = _mod.sym;',
      'let ok = sym.ok;',
      'print(ok);',
    ];
    const code = lines.join('\n');
    const hover = await getHover(code, testFile, 2, 5);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('string'),
      `Expected 'string' for sym.ok, got: ${text}`);
  });

  it('should not warn about split() on a known string property', async function() {
    const lines = [
      "import _mod from 'mymod';",
      'let info = _mod.info;',
      "let chains = split(info.chains_list, ' ');",
      'print(chains);',
    ];
    const code = lines.join('\n');
    const diags = await getDiagnostics(code, testFile);
    const splitWarnings = diags.filter(d =>
      d.message && d.message.includes('split') && d.message.includes('unknown')
    );
    assert.strictEqual(splitWarnings.length, 0,
      `split() on info.chains_list should not warn about unknown, got: ${splitWarnings.map(d => d.message).join('; ')}`);
  });

  it('should infer function type for _mod.helper', async function() {
    const lines = [
      "import _mod from 'mymod';",
      'let h = _mod.helper;',
      'print(h);',
    ];
    const code = lines.join('\n');
    const hover = await getHover(code, testFile, 1, 4);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('function'),
      `Expected 'function' for _mod.helper, got: ${text}`);
  });
});
