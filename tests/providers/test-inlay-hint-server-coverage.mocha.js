// SERVER-DRIVEN coverage for inlayHints.ts — drives textDocument/inlayHint so
// computeRawInlayHints + materializeRawHints (range filtering) run in the bundle.
// Assertive: checks that real hints (variable types + parameter names) are produced.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('inlayHints coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const FULL = { start: { line: 0, character: 0 }, end: { line: 200, character: 0 } };

  it('produces a variable TYPE hint for a non-obvious initializer', async () => {
    const code = `import { open } from 'fs';\nlet handle = open("/tmp/x", "r");\nprint(handle);\n`;
    const hints = await s.getInlayHints(code, path.join('/tmp', 'ih-type.uc'), FULL.start, FULL.end);
    assert.ok(Array.isArray(hints), 'returns hints array');
    const typeHints = hints.filter(h => {
      const label = typeof h.label === 'string' ? h.label : (h.label || []).map(p => p.value).join('');
      return label.includes(':') && /fs\.file|file/.test(label);
    });
    assert.ok(typeHints.length >= 1, `expected an fs.file type hint, got: ${JSON.stringify(hints.map(h => h.label))}`);
  });

  it('produces parameter-NAME hints at a call with non-identifier args', async () => {
    const code = `function configure(host, port, secure) { return host; }\nconfigure("localhost", 8080, true);\n`;
    const hints = await s.getInlayHints(code, path.join('/tmp', 'ih-param.uc'), FULL.start, FULL.end);
    const labels = hints.map(h => (typeof h.label === 'string' ? h.label : (h.label || []).map(p => p.value).join('')));
    const paramHints = labels.filter(l => /host:|port:|secure:/.test(l));
    assert.ok(paramHints.length >= 1, `expected parameter-name hints, got: ${JSON.stringify(labels)}`);
  });

  it('suppresses the redundant hint when arg name equals param name', async () => {
    const code = `function f(value) { return value; }\nlet value = 1;\nf(value);\n`;
    const hints = await s.getInlayHints(code, path.join('/tmp', 'ih-redundant.uc'), FULL.start, FULL.end);
    const labels = hints.map(h => (typeof h.label === 'string' ? h.label : (h.label || []).map(p => p.value).join('')));
    assert.ok(!labels.includes('value:'), `redundant 'value:' hint should be suppressed, got: ${JSON.stringify(labels)}`);
  });

  it('range filtering returns only hints inside the requested window', async () => {
    const code = `import { open } from 'fs';\nlet a = open("/1", "r");\nlet b = open("/2", "r");\nlet c = open("/3", "r");\n`;
    const narrow = { start: { line: 1, character: 0 }, end: { line: 1, character: 100 } };
    const hints = await s.getInlayHints(code, path.join('/tmp', 'ih-range.uc'), narrow.start, narrow.end);
    assert.ok(Array.isArray(hints), 'range request returns an array');
    for (const h of hints) assert.strictEqual(h.position.line, 1, `hint outside requested range: line ${h.position.line}`);
  });

  it('no hints for self-evident literal initializers', async () => {
    const code = `let n = 42;\nlet str = "hi";\nlet arr = [1, 2];\nlet obj = { a: 1 };\n`;
    const hints = await s.getInlayHints(code, path.join('/tmp', 'ih-lit.uc'), FULL.start, FULL.end);
    const typeHints = hints.filter(h => {
      const label = typeof h.label === 'string' ? h.label : (h.label || []).map(p => p.value).join('');
      return label.trim().startsWith(':');
    });
    assert.strictEqual(typeHints.length, 0, `literal inits should get no type hints, got: ${JSON.stringify(hints.map(h => h.label))}`);
  });
});
