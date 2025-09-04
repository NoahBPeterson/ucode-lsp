// Test fs import validation - ensure fs cannot be used without import

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('FS Import Validation Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

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


  describe('FS Import Validation', function() {
    it('should show error when fs.chmod is used without import', async function() {
      const testContent = `fs.chmod("lol", 0o644);`;
      
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-fs-no-import-${Date.now()}.uc`);
      
      // Should show import error
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 
        `Should show fs import error. Found diagnostics: ${diagnostics.map(d => d.message).join(', ')}`);
    });

    it('should show error when fs.open is used without import', async function() {
      const testContent = `
        let file = fs.open("/tmp/test", "r");
        fs.close(file);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '`/tmp/test-fs-open-no-import-${Date.now()}.uc`');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 'Should show fs import error for fs.open');
    });

    it('should show helpful import suggestion in error message', async function() {
      const testContent = `fs.chmod("/file", 0o644);`;
      
      const diagnostics = await getDiagnostics(testContent, '`/tmp/test-fs-suggestion-${Date.now()}.uc`');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Add: import { chmod } from 'fs';")
      );
      
      assert(importErrors.length > 0, 'Should show helpful import suggestion');
    });

    it('should NOT show error when fs is properly imported (namespace)', async function() {
      const testContent = `
        import * as fs from 'fs';
        fs.chmod("/file", 0o644);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '`/tmp/test-fs-namespace-import-${Date.now()}.uc`');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert.strictEqual(importErrors.length, 0, 
        `Should not show import error when fs is imported. Found: ${importErrors.map(d => d.message).join(', ')}`);
    });

    it('should NOT show error when fs functions are imported individually', async function() {
      const testContent = `
        import { chmod, open } from 'fs';
        chmod("/file", 0o644);
        let file = open("/tmp/test", "r");
      `;
      
      const diagnostics = await getDiagnostics(testContent, '`/tmp/test-fs-named-import-${Date.now()}.uc`');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert.strictEqual(importErrors.length, 0, 'Should not show import error for named imports');
    });

    it('should show errors for other known modules too', async function() {
      const testContent = `
        debug.memdump("/tmp/dump");
        log.openlog("test");
        math.sin(3.14);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '`/tmp/test-other-modules-${Date.now()}.uc`');
      
      const debugErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'debug' module")
      );
      
      const logErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'log' module")
      );
      
      const mathErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'math' module")
      );
      
      assert(debugErrors.length > 0, 'Should show debug import error');
      assert(logErrors.length > 0, 'Should show log import error');
      assert(mathErrors.length > 0, 'Should show math import error');
    });

    it('should handle the original reported case', async function() {
      const testContent = `fs.chmod("lol", 0o644); // No error diagnostics! You cannot use fs without importing it :(`;
      
      const diagnostics = await getDiagnostics(testContent, '`/tmp/test-original-case-${Date.now()}.uc`');
      
      // Should now show the import error (fixing the original issue)
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 
        `Should now show fs import error for the original case. Found: ${diagnostics.map(d => d.message).join(', ')}`);
    });

    it('should have reasonable performance', async function() {
      const start = Date.now();
      
      const testContent = `
        fs.chmod("/file", 0o644);
        debug.memdump("/tmp/dump");
        log.syslog(1, "test");
      `;
      
      await getDiagnostics(testContent, '`/tmp/test-performance-${Date.now()}.uc`');
      
      const elapsed = Date.now() - start;
      
      // Should be reasonably fast (under 3 seconds)
      assert(elapsed < 3000, `Import validation should be fast. Took ${elapsed}ms`);
    });
  });
});