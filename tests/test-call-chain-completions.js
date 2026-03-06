/**
 * Call Expression Chain Completions & Hover Tests
 *
 * Ensures that cursor().foreach, fs.open().read, etc.
 * get completions and hover via return-type resolution.
 */

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Call Chain Completions & Hover', () => {
  let lspServer;

  before(async function () {
    this.timeout(15000);
    lspServer = createLSPTestServer();
    await lspServer.initialize();
  });

  after(async function () {
    if (lspServer) {
      await lspServer.shutdown();
    }
  });

  // ---- Completions ----

  it('should provide cursor method completions for cursor().', async function () {
    this.timeout(10000);
    const testContent = `import { cursor } from 'uci';\ncursor().`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-1.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 9);
    const items = completions?.items || completions || [];

    console.log(`cursor(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for cursor().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('foreach'), 'Should include foreach');
    assert.ok(labels.includes('get'), 'Should include get');
    assert.ok(labels.includes('set'), 'Should include set');
  });

  it('should provide cursor method completions for uci.cursor().', async function () {
    this.timeout(10000);
    const testContent = `import * as uci from 'uci';\nuci.cursor().`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-2.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 13);
    const items = completions?.items || completions || [];

    console.log(`uci.cursor(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for uci.cursor().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('foreach'), 'Should include foreach');
    assert.ok(labels.includes('save'), 'Should include save');
    assert.ok(labels.includes('commit'), 'Should include commit');
  });

  it('should provide fs.file method completions for fs.open().', async function () {
    this.timeout(10000);
    const testContent = `import * as fs from 'fs';\nfs.open("/tmp/x").`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-3.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 18);
    const items = completions?.items || completions || [];

    console.log(`fs.open(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for fs.open().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('read'), 'Should include read');
    assert.ok(labels.includes('write'), 'Should include write');
    assert.ok(labels.includes('close'), 'Should include close');
  });

  // ---- Hover ----

  it('should show hover for foreach in cursor().foreach', async function () {
    this.timeout(10000);
    const testContent = `import { cursor } from 'uci';\ncursor().foreach("wireless", "wifi-iface", (s) => {});`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-4.uc`;

    // "foreach" starts at column 9 in line 1
    const hover = await lspServer.getHover(testContent, testFile, 1, 10);

    console.log('cursor().foreach hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for cursor().foreach');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(text.includes('foreach'), `Hover should mention foreach. Got: ${text}`);
  });

  // ---- Regression: variable-based still works ----

  it('should still provide completions for let c = cursor(); c.', async function () {
    this.timeout(10000);
    const testContent = `import { cursor } from 'uci';\nlet c = cursor();\nc.`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-5.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 2, 2);
    const items = completions?.items || completions || [];

    console.log(`c. completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for c. (assigned from cursor())');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('foreach'), 'Should include foreach');
  });

  // ---- Regression: variable-based hover still works ----

  it('should show hover for foreach in c.foreach (variable-based)', async function () {
    this.timeout(10000);
    const testContent = `import { cursor } from 'uci';\nlet c = cursor();\nc.foreach("network", "interface", (s) => {});`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-6.uc`;

    // line 2, "foreach" starts at character 2
    const hover = await lspServer.getHover(testContent, testFile, 2, 4);

    console.log('c.foreach hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for c.foreach');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(text.includes('foreach'), `Hover should mention foreach. Got: ${text}`);
  });

  // ---- Type inference for chained call results ----

  it('should infer type of variable assigned from fs.open().read()', async function () {
    this.timeout(10000);
    const testContent = `import * as fs from 'fs';\nlet config = fs.open("/etc/config/network", "r").read("all");\n`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-7.uc`;

    const hover = await lspServer.getHover(testContent, testFile, 1, 5);

    console.log('config hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for config');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(!text.includes('unknown'), `Variable type should not be unknown. Got: ${text}`);
  });

  // ---- io module call chains ----

  it('should provide io.handle method completions for io.open().', async function () {
    this.timeout(10000);
    const testContent = `import * as io from 'io';\nio.open("/tmp/data.txt", "r").`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-8.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 29);
    const items = completions?.items || completions || [];

    console.log(`io.open(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for io.open().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('read'), 'Should include read');
    assert.ok(labels.includes('write'), 'Should include write');
    assert.ok(labels.includes('close'), 'Should include close');
    assert.ok(labels.includes('error'), 'Should include error');
  });

  it('should provide fs.dir method completions for fs.opendir().', async function () {
    this.timeout(10000);
    const testContent = `import * as fs from 'fs';\nfs.opendir("/tmp").`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-9.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 19);
    const items = completions?.items || completions || [];

    console.log(`fs.opendir(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for fs.opendir().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('read'), 'Should include read');
    assert.ok(labels.includes('close'), 'Should include close');
    assert.ok(labels.includes('tell'), 'Should include tell');
  });

  it('should provide fs.proc method completions for fs.popen().', async function () {
    this.timeout(10000);
    const testContent = `import * as fs from 'fs';\nfs.popen("ls").`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-10.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 15);
    const items = completions?.items || completions || [];

    console.log(`fs.popen(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for fs.popen().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('read'), 'Should include read');
    assert.ok(labels.includes('close'), 'Should include close');
  });

  // ---- Hover on chained methods ----

  it('should show hover for read in fs.open().read', async function () {
    this.timeout(10000);
    const testContent = `import * as fs from 'fs';\nfs.open("/tmp/x", "r").read("all");`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-11.uc`;

    // "read" starts at column 23 on line 1
    const hover = await lspServer.getHover(testContent, testFile, 1, 24);

    console.log('fs.open().read hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for fs.open().read');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(text.includes('read'), `Hover should mention read. Got: ${text}`);
  });

  it('should show hover for close in io.open().close', async function () {
    this.timeout(10000);
    const testContent = `import * as io from 'io';\nio.open("/tmp/x", "r").close();`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-12.uc`;

    // "close" starts at column 23 on line 1
    const hover = await lspServer.getHover(testContent, testFile, 1, 24);

    console.log('io.open().close hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for io.open().close');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(text.includes('close'), `Hover should mention close. Got: ${text}`);
  });

  it('should show hover for commit in uci.cursor().commit', async function () {
    this.timeout(10000);
    const testContent = `import * as uci from 'uci';\nuci.cursor().commit("network");`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-13.uc`;

    // "commit" starts at column 13 on line 1
    const hover = await lspServer.getHover(testContent, testFile, 1, 15);

    console.log('uci.cursor().commit hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for uci.cursor().commit');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(text.includes('commit'), `Hover should mention commit. Got: ${text}`);
  });

  // ---- Type inference: more cases ----

  it('should infer type of variable assigned from io.open().read()', async function () {
    this.timeout(10000);
    const testContent = `import * as io from 'io';\nlet data = io.open("/tmp/data.txt", "r").read("all");\n`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-14.uc`;

    const hover = await lspServer.getHover(testContent, testFile, 1, 5);

    console.log('data hover:', JSON.stringify(hover, null, 2));

    assert.ok(hover, 'Should have hover response for data');
    const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
    assert.ok(!text.includes('unknown'), `Variable type should not be unknown. Got: ${text}`);
  });

  // ---- Named import call chains ----

  it('should provide completions for named import open().', async function () {
    this.timeout(10000);
    const testContent = `import { open } from 'fs';\nopen("/tmp/x", "r").`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-15.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 20);
    const items = completions?.items || completions || [];

    console.log(`open(). completions: ${items.length}`);
    items.forEach(i => console.log(`  - ${i.label}`));

    assert.ok(items.length > 0, 'Should return completions for bare open().');
    const labels = items.map(i => i.label);
    assert.ok(labels.includes('read'), 'Should include read');
    assert.ok(labels.includes('write'), 'Should include write');
    assert.ok(labels.includes('close'), 'Should include close');
  });

  // ---- Completions should have correct item kinds ----

  it('should mark call chain completions as Method kind', async function () {
    this.timeout(10000);
    const testContent = `import { cursor } from 'uci';\ncursor().`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-16.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 1, 9);
    const items = completions?.items || completions || [];

    assert.ok(items.length > 0, 'Should return completions');
    const foreachItem = items.find(i => i.label === 'foreach');
    assert.ok(foreachItem, 'Should have foreach completion');
    assert.strictEqual(foreachItem.kind, 2, 'foreach should have kind=2 (Method)');
    assert.ok(foreachItem.detail.includes('uci.cursor'), `detail should mention uci.cursor. Got: ${foreachItem.detail}`);
  });

  // ---- No completions for unknown functions ----

  it('should not return completions for unknown_func().', async function () {
    this.timeout(10000);
    const testContent = `unknown_func().`;
    const testFile = `/tmp/test-call-chain-${Date.now()}-17.uc`;

    const completions = await lspServer.getCompletions(testContent, testFile, 0, 15);
    const items = completions?.items || completions || [];

    console.log(`unknown_func(). completions: ${items.length}`);

    // Should fall through to general completions or return nothing specific
    // The key is it shouldn't crash or return object method completions
    const hasObjectMethods = items.some(i => ['foreach', 'read', 'write', 'close'].includes(i.label));
    assert.ok(!hasObjectMethods, 'Should not return object method completions for unknown function');
  });
});
