const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Module Completions Integration Test', function() {
  this.timeout(15000);

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

  it('should return builtin and system modules', async function() {
    const testContent = "import * as modules from '";
    const testFilePath = path.resolve(__dirname, 'test_module_count.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    const minExpectedModules = 15;
    assert(completions.length >= minExpectedModules, `Expected at least ${minExpectedModules} modules, got ${completions.length}`);

    const builtinCount = completions.filter(c => c.detail === 'ucode builtin module').length;
    const systemCount = completions.filter(c => c.detail === 'ucode system module').length;

    assert.strictEqual(builtinCount, 15, 'All 15 builtin modules should be present');
    console.log(`Found ${builtinCount} builtin modules and ${systemCount} system modules`);
  });

  it('should have all required completion fields', async function() {
    const testContent = "import * as test from '";
    const testFilePath = path.resolve(__dirname, 'test_completion_fields.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    assert(completions.length > 0, 'Expected at least one completion');

    completions.forEach((item, index) => {
      assert(item.label, `Completion ${index} missing label`);
      assert(typeof item.kind === 'number', `Completion ${index} missing or invalid kind`);
      assert(item.detail, `Completion ${index} missing detail`);
      assert(item.documentation, `Completion ${index} missing documentation`);
      assert(item.insertText, `Completion ${index} missing insertText`);
      assert(item.sortText, `Completion ${index} missing sortText`);
    });
  });

  it('should include all required builtin modules', async function() {
    const testContent = "import * as all from '";
    const testFilePath = path.resolve(__dirname, 'test_all_modules.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    const moduleNames = completions.map(c => c.label);
    const requiredModules = ['fs', 'debug', 'log', 'math', 'ubus', 'uci', 'uloop', 'digest', 'nl80211', 'resolv', 'rtnl', 'socket', 'struct', 'zlib'];

    const missingModules = requiredModules.filter(module => !moduleNames.includes(module));
    assert.strictEqual(missingModules.length, 0, `Missing required modules: ${missingModules.join(', ')}`);
  });

  it('should have correct completion properties', async function() {
    const testContent = "import * as props from '";
    const testFilePath = path.resolve(__dirname, 'test_completion_props.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    const fsCompletion = completions.find(c => c.label === 'fs');
    assert(fsCompletion, 'Expected fs completion');

    assert.strictEqual(fsCompletion.kind, 9, 'Expected Module kind (9)');
    assert.strictEqual(fsCompletion.detail, 'ucode builtin module', 'Expected correct detail');
    assert.strictEqual(fsCompletion.insertText, 'fs', 'Expected correct insertText');
    assert.strictEqual(fsCompletion.sortText, '0_fs', 'Expected correct sortText for prioritization');

    assert(fsCompletion.documentation, 'Expected documentation object');
    assert.strictEqual(fsCompletion.documentation.kind, 'markdown', 'Expected markdown documentation');
    assert(fsCompletion.documentation.value.includes('fs'), 'Expected documentation to contain module name');
    assert(fsCompletion.documentation.value.includes('```ucode'), 'Expected code example in documentation');
  });

  it('should provide completions with proper sorting', async function() {
    const testContent = "import * as sorted from '";
    const testFilePath = path.resolve(__dirname, 'test_sorting.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    completions.forEach((item, index) => {
      const isBuiltin = item.detail === 'ucode builtin module';
      const isSystem = item.detail === 'ucode system module';

      if (isBuiltin) {
        assert(item.sortText.startsWith('0_'), `Builtin completion ${index} (${item.label}) should have sortText starting with '0_', got: ${item.sortText}`);
      } else if (isSystem) {
        assert(item.sortText.startsWith('1_'), `System completion ${index} (${item.label}) should have sortText starting with '1_', got: ${item.sortText}`);
      }
    });

    const builtinModules = completions.filter(c => c.detail === 'ucode builtin module');
    const systemModules = completions.filter(c => c.detail === 'ucode system module');

    assert(completions.length > 0, 'Expected completions to validate sorting');
    assert(builtinModules.length > 0, 'Expected builtin modules');

    if (systemModules.length > 0) {
      const firstBuiltin = builtinModules[0];
      const firstSystem = systemModules[0];
      assert(firstBuiltin.sortText < firstSystem.sortText, 'Builtin modules should sort before system modules');
    }
  });

  it('should provide markdown documentation for all modules', async function() {
    const testContent = "import * as docs from '";
    const testFilePath = path.resolve(__dirname, 'test_documentation.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    completions.forEach((item, index) => {
      assert(item.documentation, `Completion ${index} (${item.label}) missing documentation`);
      assert.strictEqual(item.documentation.kind, 'markdown', `Completion ${index} (${item.label}) should have markdown documentation`);

      const docValue = item.documentation.value;
      assert(docValue.includes(item.label), `Documentation for ${item.label} should contain the module name`);
      assert(docValue.includes('```ucode'), `Documentation for ${item.label} should contain code example`);
      assert(docValue.includes(`import * as ${item.label} from '${item.label}'`), `Documentation for ${item.label} should contain proper import example`);
    });
  });
});
