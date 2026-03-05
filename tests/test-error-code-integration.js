const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Error Code Integration Tests', function() {
  this.timeout(10000);

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

  describe('Error Code Diagnostics', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-error-codes.uc');

    before(async function() {
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }

      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
    });

    it('should include error codes in diagnostics', function() {
      console.log(`Total diagnostics found: ${diagnostics.length}`);
      console.log('All diagnostics:');
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Code: ${d.code || 'none'}, Message: "${d.message}", Severity: ${d.severity}`);
      });

      const diagnosticsWithCodes = diagnostics.filter(d => d.code);
      console.log(`Diagnostics with codes: ${diagnosticsWithCodes.length}`);
      assert(diagnosticsWithCodes.length > 0, 'At least some diagnostics should have error codes');
    });

    it('should have UNDEFINED_VARIABLE error code for undefined variables', function() {
      const undefinedVarErrors = diagnostics.filter(d =>
        d.code === 'UC1001' || d.message.includes('Undefined variable')
      );
      assert(undefinedVarErrors.length > 0, 'Should have undefined variable errors');
    });

    it('should have VARIABLE_REDECLARATION error code for redeclared variables', function() {
      const redeclarationErrors = diagnostics.filter(d =>
        d.code === 'UC1003' || d.message.includes('already declared')
      );
      assert(redeclarationErrors.length > 0, 'Should have variable redeclaration errors');
    });

    it('should have UNUSED_VARIABLE warning code for unused variables', function() {
      const unusedVarWarnings = diagnostics.filter(d =>
        d.code === 'UC1006' || d.message.includes('never used')
      );
      assert(unusedVarWarnings.length > 0, 'Should have unused variable warnings');
    });

    it('should have EXPORT_NOT_FOUND error code for invalid exports', function() {
      const invalidExportErrors = diagnostics.filter(d =>
        d.code === 'UC3005' || d.message.includes('does not export')
      );
      assert(invalidExportErrors.length > 0, 'Should have invalid export errors');
    });
  });
});
