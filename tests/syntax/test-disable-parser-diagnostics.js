const assert = require('assert');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Disable Comments Parser Diagnostics Tests', function() {
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

  describe('Parser Diagnostic Suppression', function() {
    it('should suppress parser diagnostics on lines with disable comments', async function() {
      const testContent = `let nlresult = nl.request(); // ucode-lsp disable`;
      const testFilePath = `/tmp/test-parser-disable-${Date.now()}.uc`;
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nParser disable test diagnostics: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Ticket 08: a disable comment now REMOVES diagnostics on the line entirely.
      const line0 = diagnostics.filter(d => d.range.start.line === 0);
      assert.strictEqual(line0.length, 0, 'Disabled line should have no diagnostics of any severity');
    });

    it('should suppress both parser and semantic diagnostics on disabled lines', async function() {
      const testContent = `let undefinedVar = someUndefinedFunction(); // ucode-lsp disable
let anotherVar = anotherUndefinedFunction();`;
      const testFilePath = `/tmp/test-both-disable-${Date.now()}.uc`;
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nBoth diagnostics test: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Ticket 08: line 0 is disabled -> all its diagnostics are removed; line 1 keeps errors.
      const line0Diagnostics = diagnostics.filter(d => d.range.start.line === 0);
      const line1Diagnostics = diagnostics.filter(d => d.range.start.line === 1);

      const line1Errors = line1Diagnostics.filter(d => d.severity === 1);

      assert.strictEqual(line0Diagnostics.length, 0, 'Line 0 should have no diagnostics (disabled)');
      assert(line1Errors.length > 0, 'Line 1 should have error-level diagnostics (not disabled)');
    });

    it('should only suppress diagnostics on the specific disabled line', async function() {
      const testContent = `let error1 = undefinedFunction1();
let error2 = undefinedFunction2(); // ucode-lsp disable
let error3 = undefinedFunction3();`;
      const testFilePath = `/tmp/test-specific-line-disable-${Date.now()}.uc`;
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nSpecific line disable test: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      const line0Diagnostics = diagnostics.filter(d => d.range.start.line === 0);
      const line1Diagnostics = diagnostics.filter(d => d.range.start.line === 1);
      const line2Diagnostics = diagnostics.filter(d => d.range.start.line === 2);
      
      // Line 0 should have errors (not disabled)
      const line0Errors = line0Diagnostics.filter(d => d.severity === 1);
      assert(line0Errors.length > 0, 'Line 0 should have error-level diagnostics (not disabled)');
      
      // Ticket 08: line 1 is disabled -> all its diagnostics are removed.
      assert.strictEqual(line1Diagnostics.length, 0, 'Line 1 should have no diagnostics (disabled)');
      
      // Line 2 should have errors (not disabled)
      const line2Errors = line2Diagnostics.filter(d => d.severity === 1);
      assert(line2Errors.length > 0, 'Line 2 should have error-level diagnostics (not disabled)');
    });
  });
});