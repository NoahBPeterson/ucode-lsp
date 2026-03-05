const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Import Completion Test', function() {
  this.timeout(10000);

  let lspServer;
  let getCompletions;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  it('should provide completions for builtin modules at end of import string', async function() {
    const testContent = "import * as lol from '";
    const testFilePath = path.resolve(__dirname, `test_import_completion_${Date.now()}.uc`);
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    assert(completions.length > 0, 'Expected completions for builtin modules');

    const moduleNames = completions.map(c => c.label);
    console.log('Available modules:', moduleNames);

    const expectedModules = ['fs', 'debug', 'log', 'math', 'ubus', 'uci', 'uloop', 'digest', 'nl80211', 'resolv', 'rtnl', 'socket', 'struct', 'zlib'];
    for (const module of expectedModules) {
      assert(moduleNames.includes(module), `Expected "${module}" in completions`);
    }

    const fsCompletion = completions.find(c => c.label === 'fs');
    assert(fsCompletion, 'Expected fs completion item');
    assert.strictEqual(fsCompletion.kind, 9, 'Expected Module kind (9)');
    assert.strictEqual(fsCompletion.detail, 'ucode builtin module', 'Expected correct detail');
    assert(fsCompletion.insertText, 'Expected insertText');
  });

  it('should provide completions when cursor is inside import string', async function() {
    const testContent = "import * as lol from 'f'";
    const testFilePath = path.resolve(__dirname, 'test_import_completion2.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, 23);

    assert(completions.length > 0, 'Expected completions for builtin modules');

    const moduleNames = completions.map(c => c.label);
    assert(moduleNames.includes('fs'), 'Expected "fs" in completions when cursor inside string');
  });

  it('should provide completions after from keyword with space', async function() {
    const testContent = "import * as lol from ";
    const testFilePath = path.resolve(__dirname, 'test_import_completion3.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    assert(completions.length > 0, 'Expected completions after from keyword');

    const moduleNames = completions.map(c => c.label);
    assert(moduleNames.includes('fs'), 'Expected "fs" in completions after from keyword');
  });

  it('should NOT provide module completions in regular string literals', async function() {
    const testContent = "let x = 'f";
    const testFilePath = path.resolve(__dirname, 'test_import_completion4.uc');

    try {
      const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

      const moduleNames = completions.map(c => c.label);
      const hasModuleCompletions = moduleNames.includes('fs');
      assert(!hasModuleCompletions || completions.length === 0, 'Should NOT get module completions in regular strings');
    } catch (error) {
      if (error.message.includes('Timeout waiting for completion response')) {
        console.log('   ✓ No completions provided (as expected) - LSP did not respond');
        return;
      }
      throw error;
    }
  });

  it('should NOT provide module completions outside import context', async function() {
    const testContent = "fs.";
    const testFilePath = path.resolve(__dirname, 'test_import_completion5.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    const hasModuleNames = completions.some(c => ['fs', 'debug', 'uci'].includes(c.label));
    assert(!hasModuleNames, 'Should NOT get module name completions outside import context');
  });
});
