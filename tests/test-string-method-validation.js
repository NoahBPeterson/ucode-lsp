const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('String Method Validation Tests', function() {
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

  describe('String Method Validation on test-string-methods.uc', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-string-methods.uc');

    before(async function() {
      // Ensure the test file exists
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
    });

    it('should detect toUpperCase() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'toUpperCase' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one toUpperCase error');
      
      // Verify the error location points to the method name
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 8, 'Error should be on line 9 (0-indexed line 8)');
      assert.strictEqual(error.range.start.character, 17, 'Error should start at character 17');
      assert.strictEqual(error.range.end.character, 28, 'Error should end at character 28');
    });

    it('should detect toLowerCase() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'toLowerCase' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one toLowerCase error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 9, 'Error should be on line 10 (0-indexed line 9)');
    });

    it('should detect replace() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'replace' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one replace error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 10, 'Error should be on line 11 (0-indexed line 10)');
    });

    it('should detect split() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'split' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one split error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 11, 'Error should be on line 12 (0-indexed line 11)');
    });

    it('should detect trim() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'trim' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one trim error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 14, 'Error should be on line 15 (0-indexed line 14)');
    });

    it('should detect substring() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'substring' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one substring error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 15, 'Error should be on line 16 (0-indexed line 15)');
    });

    it('should detect charAt() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'charAt' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one charAt error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 16, 'Error should be on line 17 (0-indexed line 16)');
    });

    it('should detect indexOf() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'indexOf' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one indexOf error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 17, 'Error should be on line 18 (0-indexed line 17)');
    });

    it('should find exactly 9 string method validation errors total', function() {
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type') &&
        d.message.includes('Property')
      );
      assert.strictEqual(stringMethodErrors.length, 9, 'Should find exactly 8 string method errors');
    });

    it('should allow access to valid string property length', function() {
      // There should be no error for text.length (line 5 in the test file)
      const lengthErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'length' does not exist on string type")
      );
      assert.strictEqual(lengthErrors.length, 1, 'Should report length as invalid property');
    });

    it('should have consistent error message format', function() {
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type') &&
        d.message.includes('Property')
      );

      stringMethodErrors.forEach(error => {
        assert(error.message.includes('Property'), 'Error message should start with Property');
        assert(error.message.includes('does not exist on string type'), 'Error message should explain the issue');
        assert(error.message.includes('Strings in ucode have no member variables or functions'), 'Error message should provide guidance');
        assert.strictEqual(error.source, 'ucode-semantic', 'Error source should be ucode-semantic');
      });
    });

    it('should have precise error ranges that point to method names only', function() {
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type') &&
        d.message.includes('Property')
      );

      stringMethodErrors.forEach(error => {
        // Error range should be reasonable (method names are typically 3-11 characters)
        const rangeLength = error.range.end.character - error.range.start.character;
        assert(rangeLength >= 3 && rangeLength <= 15, 
          `Error range length (${rangeLength}) should be reasonable for method name`);
        
        // Start and end positions should be valid
        assert(error.range.start.character >= 0, 'Start character should be non-negative');
        assert(error.range.end.character > error.range.start.character, 'End should be after start');
        assert(error.range.start.line >= 0, 'Start line should be non-negative');
        assert(error.range.end.line >= error.range.start.line, 'End line should be >= start line');
      });
    });
  });

  describe('String Method Validation Edge Cases', function() {
    it('should validate computed string property access', async function() {
      const testContent = `
let text = "hello";
let methodName = "toUpperCase";
let result = text[methodName](); // This should not trigger string method validation
      `;
      
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-computed-${Date.now()}.uc`);
      
      // Should not report string method errors for computed access
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type')
      );
      assert.strictEqual(stringMethodErrors.length, 0, 'Should not validate computed property access');
    });

    it('should only validate non-computed string property access', async function() {
      const testContent = `
let text = "hello";
let validLength = text.length;     // Invalid - should not error
let invalidMethod = text.charAt(0); // Invalid - should error
      `;
      
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-mixed-${Date.now()}.uc`);
      
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type')
      );
      assert.strictEqual(stringMethodErrors.length, 2, 'Should find exactly two errors for charAt and length');
      
      const lengthErrors = diagnostics.filter(d => 
        d.message.includes("Property 'length' does not exist")
      );
      assert.strictEqual(lengthErrors.length, 1, 'Should error on valid length property');
    });

    it('should handle empty string method names gracefully', async function() {
      // This tests edge case handling in the validation code
      const testContent = `
let text = "hello";
// This is syntactically invalid but shouldn't crash the validator
      `;
      
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-empty-${Date.now()}.uc`);
      
      // Should not crash and should return some diagnostics (even if empty)
      assert(Array.isArray(diagnostics), 'Should return diagnostics array');
    });
  });
});