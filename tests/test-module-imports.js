// General module import behavior tests
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('General Module Import Tests', function() {
  this.timeout(15000);

  let lspServer;
  let getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  describe("'default_only.uc' Module", function() {
    it('should allow default import', async function() {
      const testContent = `import MyDefault from './tests/module_tests/default_only.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for valid default import.");
    });

    it('should NOT allow named import', async function() {
      const testContent = `import { foo } from './tests/module_tests/default_only.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.ok(diagnostics.some(d => d.message.includes("does not export 'foo'")), "Should have a diagnostic for invalid named import.");
    });
  });

  describe("'default_and_named_vars.uc' Module", function() {
    it('should allow default and named import', async function() {
      const testContent = `import MyDefault, { foo } from './tests/module_tests/default_and_named_vars.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for valid default and named import.");
    });

    it('should NOT allow importing a non-existent named export', async function() {
      const testContent = `import { bar } from './tests/module_tests/default_and_named_vars.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.ok(diagnostics.some(d => d.message.includes("does not export 'bar'")), "Should have a diagnostic for invalid named import.");
    });
  });

  describe("'default_and_named_funcs.uc' Module", function() {
    it('should allow default and named function import', async function() {
      const testContent = `import Default, { myFunc } from './tests/module_tests/default_and_named_funcs.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      console.log(diagnostics);
      assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for valid default and named function import.");
    });
  });

  describe("'default_and_named_funcs_2.uc' Module", function() {
    it('should allow default and named function import', async function() {
      const testContent = `import Default, { myFunc } from './tests/module_tests/default_and_named_funcs_2.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      console.log(diagnostics);
      assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for valid default and named function import.");
    });
  });

  describe("'named_only.uc' Module", function() {
    it('should allow named imports', async function() {
      const testContent = `import { foo, myFunc } from './tests/module_tests/named_only.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for valid named imports.");
    });

    it('should NOT allow default import', async function() {
      const testContent = `import MyDefault from './tests/module_tests/named_only.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.ok(diagnostics.some(d => d.message.includes("does not have a default export")), "Should have a diagnostic for invalid default import.");
    });
  });

  describe("'mixed_exports.uc' Module", function() {
    it('should allow default and multiple named imports', async function() {
      const testContent = `import MyDefault, { myVar, myFunc } from './tests/module_tests/mixed_exports.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.strictEqual(diagnostics.length, 0, "Should have no diagnostics for valid mixed imports.");
    });

    it('should NOT allow importing a non-exported variable', async function() {
      const testContent = `import { notExported, lol } from './tests/module_tests/mixed_exports.uc';`;
      const diagnostics = await getDiagnostics(testContent, 'test.uc');
      assert.ok(diagnostics.some(d => d.message.includes("does not export 'notExported'")), "Should have a diagnostic for non-exported variable.");
    });
  });
});