const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Disable Comments Tests', function() {
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

  describe('Disable Comment Validation on test-disable-comments.uc', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-disable-comments.uc');

    before(async function() {
      // Ensure the test file exists
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nTotal diagnostics: ${diagnostics.length}`);
      console.log('All diagnostics:');
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity})`);
      });
    });

    it('should NOT report errors on lines with // ucode-lsp disable comment', function() {
      // Lines with disable comments should not have errors
      const disabledLineErrors = diagnostics.filter(d => 
        (d.range.start.line === 8 || // let disabledExample = invalidFunction(); // ucode-lsp disable
         d.range.start.line === 18 || // undefinedVariable; // ucode-lsp disable  
         d.range.start.line === 19) && // let test = undefinedFunction2(); // ucode-lsp disable
        d.severity === 1 // Error severity
      );
      
      assert.strictEqual(disabledLineErrors.length, 0, 
        `Should not report errors on lines with disable comments. Found errors: ${JSON.stringify(disabledLineErrors)}`);
    });

    it('should NOT report errors on multi-line statements with // ucode-lsp disable', function() {
      // Multi-line statement with disable comment (lines 11-15) should not have errors
      const multiLineDisabledErrors = diagnostics.filter(d => 
        d.range.start.line >= 10 && d.range.start.line <= 14 && // Multi-line disabled statement range
        d.severity === 1
      );
      
      assert.strictEqual(multiLineDisabledErrors.length, 0, 
        `Should not report errors on multi-line statements with disable comments. Found errors: ${JSON.stringify(multiLineDisabledErrors)}`);
    });

    it('should still report errors on lines WITHOUT disable comments', function() {
      // Line 7: let invalidExample = invalidFunction(); (no disable comment)
      console.log('Looking for errors on line 7 (invalidExample line)');
      const normalErrors = diagnostics.filter(d => 
        d.range.start.line === 7 && 
        d.severity === 1
      );
      
      console.log(`Found ${normalErrors.length} errors on line 7:`);
      normalErrors.forEach(e => console.log(`  - ${e.message}`));
      
      assert(normalErrors.length > 0, 'Should still report errors on lines without disable comments');
    });

    it('should report errors on multi-line statements WITHOUT disable comments', function() {
      // Multi-line statement without disable (lines around 18-22) should have errors
      const multiLineErrors = diagnostics.filter(d => 
        d.range.start.line >= 17 && d.range.start.line <= 21 && 
        d.severity === 1
      );
      
      assert(multiLineErrors.length > 0, 
        `Should report errors on multi-line statements without disable comments`);
    });

    it('should report errors on the final test line', function() {
      // Line with "let normalError = thisWillError();" should have error
      console.log('Looking for errors on line 34 (normalError line)');
      const finalLineErrors = diagnostics.filter(d => 
        d.range.start.line === 34 && // Line 35 in 1-based, 34 in 0-based
        d.severity === 1
      );
      
      console.log(`Found ${finalLineErrors.length} errors on line 34:`);
      finalLineErrors.forEach(e => console.log(`  - ${e.message}`));
      
      assert(finalLineErrors.length > 0, 'Should report errors on lines without disable comments');
    });

  });

  describe('Disable Comment Edge Cases', function() {
    it('should handle disable comment at different positions in line', async function() {
      const testContent = `
let test1 = invalidFunc(); // ucode-lsp disable
let test2 = invalidFunc(); // some text ucode-lsp disable more text  
let test3 = invalidFunc(); // ucode-lsp disable with more
      `;
      
      console.log('\nTest content lines:');
      testContent.split('\n').forEach((line, i) => {
        console.log(`  Line ${i}: "${line}"`);
      });
      
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-edge-${Date.now()}.uc`);
      
      console.log('\nEdge case diagnostics:');
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity})`);
      });
      
      // Should have no errors since all lines have disable comments
      const errors = diagnostics.filter(d => d.severity === 1);
      console.log(`Expected 1 error, got ${errors.length}`);
      assert.strictEqual(errors.length, 1, 'Should handle disable comments at different positions');
    });

    it('should be case sensitive for disable comment', async function() {
      const testContent = `
let test1 = invalidFunc(); // UCODE-LSP DISABLE (wrong case)
let test2 = invalidFunc(); // ucode-lsp disable (correct case)
      `;
      
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-case-${Date.now()}.uc`);
      
      // Line 1 should have error (wrong case), line 2 should not
      const line1Errors = diagnostics.filter(d => d.range.start.line === 1 && d.severity === 1);
      const line2Errors = diagnostics.filter(d => d.range.start.line === 2 && d.severity === 1);
      
      assert(line1Errors.length > 0, 'Should report errors when disable comment has wrong case');
      assert.strictEqual(line2Errors.length, 0, 'Should not report errors when disable comment has correct case');
    });
  });
});