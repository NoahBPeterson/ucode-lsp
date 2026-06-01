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

describe('Cross-file references via namespace import', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, 'fixtures', 'xref-ns');
  const modPath = path.join(wsRoot, 'mod.uc');
  const modContent = fs.readFileSync(modPath, 'utf8');
  let lspServer, getCodeLens, resolveCodeLens;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
    getCodeLens = lspServer.getCodeLens;
    resolveCodeLens = lspServer.resolveCodeLens;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  it('counts `ns.thing()` accesses through `import * as ns`', async function() {
    const declLine = modContent.split('\n').findIndex(l => /function thing\b/.test(l));
    const lenses = await getCodeLens(modContent, modPath);
    const lens = lenses.find(l => l.data && l.data.kind === 'refs' && l.range.start.line === declLine);
    assert.ok(lens, 'expected a refs lens on thing');
    const resolved = await resolveCodeLens(lens);
    assert.strictEqual(resolved.command.title, '2 references',
      `expected 2 namespace references, got: ${JSON.stringify(resolved.command.title)}`);
    const locations = resolved.command.arguments[2];
    assert.ok(locations.every(l => l.uri.endsWith('consumer.uc')),
      `references should be in consumer.uc, got: ${JSON.stringify(locations.map(l => l.uri))}`);
  });
});

describe('Cross-file references for factory-returned methods', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, 'fixtures', 'xref-factory');
  const modPath = path.join(wsRoot, 'factory.uc');
  const modContent = fs.readFileSync(modPath, 'utf8');
  let lspServer, getCodeLens, resolveCodeLens;

  before(async function() {
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

  it('counts `inst.do_thing()` where `inst = make(...)` across files', async function() {
    // 1 in-file (the `return { do_thing }` shorthand) + 3 cross-file usages.
    const resolved = await refsLensFor('do_thing');
    assert.strictEqual(resolved.command.title, '4 references',
      `got: ${JSON.stringify(resolved.command.title)}`);
    const locations = resolved.command.arguments[2];
    const crossFile = locations.filter(l => l.uri.endsWith('consumer.uc'));
    assert.strictEqual(crossFile.length, 3, `expected 3 cross-file usages, got ${crossFile.length}`);
  });

  it('a returned-but-unused method has no cross-file references', async function() {
    // Only the in-file `return { unused_method }` shorthand.
    const resolved = await refsLensFor('unused_method');
    assert.strictEqual(resolved.command.title, '1 reference',
      `got: ${JSON.stringify(resolved.command.title)}`);
  });
});

describe('Cross-file references: NAMED-export factory methods + aliased receivers', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, 'fixtures', 'xref-named-factory');
  const modPath = path.join(wsRoot, 'lib.uc');
  const modContent = fs.readFileSync(modPath, 'utf8');
  let lspServer, getCodeLens, resolveCodeLens;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
    getCodeLens = lspServer.getCodeLens;
    resolveCodeLens = lspServer.resolveCodeLens;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  it('counts method usages from a named-export factory, including aliased receivers', async function() {
    const declLine = modContent.split('\n').findIndex(l => /function do_thing\b/.test(l));
    const lenses = await getCodeLens(modContent, modPath);
    const lens = lenses.find(l => l.data && l.data.kind === 'refs' && l.range.start.line === declLine);
    assert.ok(lens, 'expected a refs lens on do_thing');
    const resolved = await resolveCodeLens(lens);
    // 1 in-file return shorthand + 3 cross-file (`w.`, aliased `w2.`, chained `w3.`).
    assert.strictEqual(resolved.command.title, '4 references',
      `got: ${JSON.stringify(resolved.command.title)}`);
    const crossFile = resolved.command.arguments[2].filter(l => l.uri.endsWith('use.uc'));
    assert.strictEqual(crossFile.length, 3, `expected 3 cross-file usages (direct + 2 aliases), got ${crossFile.length}`);
  });
});
