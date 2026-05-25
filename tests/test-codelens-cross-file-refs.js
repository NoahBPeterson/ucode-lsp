const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Cross-file references for the "N references" CodeLens. The fixture workspace
// has mod.uc (default-exported widget_make + named-exported widget_help) and
// consumer.uc (imports both, uses widget_make twice and widget_help once). The
// count must include the cross-file USAGES but NOT the import statements or the
// `export default` in mod.uc.
describe('Cross-file references CodeLens', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, 'fixtures', 'xref');
  const modPath = path.join(wsRoot, 'mod.uc');
  const modContent = fs.readFileSync(modPath, 'utf8');
  let lspServer, getCodeLens, resolveCodeLens;

  before(async function() {
    // Custom workspaceRoot → dedicated server (bypasses the shared one).
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
    getCodeLens = lspServer.getCodeLens;
    resolveCodeLens = lspServer.resolveCodeLens;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  async function refsLensFor(fnName) {
    const declLine = modContent.split('\n').findIndex(l => new RegExp(`function ${fnName}\\b`).test(l));
    const lenses = await getCodeLens(modContent, modPath);
    const lens = lenses.find(l => l.data && l.data.kind === 'refs' && l.range.start.line === declLine);
    assert.ok(lens, `expected a refs lens on ${fnName} (line ${declLine})`);
    return resolveCodeLens(lens);
  }

  it('default export: counts cross-file usages, excludes import + export default', async function() {
    const resolved = await refsLensFor('widget_make');
    assert.strictEqual(resolved.command.title, '2 references',
      `got: ${JSON.stringify(resolved.command.title)}`);
    const locations = resolved.command.arguments[2];
    assert.strictEqual(locations.length, 2, `expected 2 locations, got ${locations.length}`);
    assert.ok(locations.every(l => l.uri.endsWith('consumer.uc')),
      `all references should be in consumer.uc, got: ${JSON.stringify(locations.map(l => l.uri))}`);
  });

  it('named export: counts the cross-file usage, excludes the named import', async function() {
    const resolved = await refsLensFor('widget_help');
    assert.strictEqual(resolved.command.title, '1 reference',
      `got: ${JSON.stringify(resolved.command.title)}`);
    const locations = resolved.command.arguments[2];
    assert.strictEqual(locations.length, 1, `expected 1 location, got ${locations.length}`);
    assert.ok(locations[0].uri.endsWith('consumer.uc'));
  });
});
