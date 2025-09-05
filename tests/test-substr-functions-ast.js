// AST-based LSP integration test for substr function validation
console.log('🧪 Running AST-based Substr Function LSP Validation Tests...\n');

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Substr Function AST Validation Tests', function() {
  this.timeout(15000); // 15 second timeout

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

  describe('substr() function validation', function() {
    it('should NOT show error for substr() with valid string and number parameters', async function() {
      const testContent = `
let text = "hello world";
substr(text, 0);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-valid.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("string") || d.message.includes("integer"))
      );
      
      assert.strictEqual(substrErrors.length, 0, 
        `substr() with valid parameters should not produce errors. Found: ${substrErrors.map(e => e.message).join(', ')}`);
    });

    it('should NOT show error for substr() with three valid parameters', async function() {
      const testContent = `
let text = "hello world";
substr(text, 6, 5);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-three-params.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("string") || d.message.includes("integer"))
      );
      
      assert.strictEqual(substrErrors.length, 0, 
        `substr() with three valid parameters should not produce errors. Found: ${substrErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for substr() with invalid string parameter', async function() {
      const testContent = `
let num = 123;
substr(num, 0);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-invalid-string.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        d.message.includes("string")
      );
      
      assert(substrErrors.length > 0, 'substr() with invalid string parameter should produce type error');
    });

    it('should show error for substr() with invalid number parameter', async function() {
      const testContent = `
let text = "hello";
substr(text, "invalid");
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-invalid-number.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("integer") || d.message.includes("double"))
      );
      
      assert(substrErrors.length > 0, 'substr() with invalid number parameter should produce type error');
    });

    it('should show error for substr() with invalid array parameter', async function() {
      const testContent = `
let arr = [1, 2, 3];
substr(arr, 0);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-array.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        d.message.includes("string")
      );
      
      assert(substrErrors.length > 0, 'substr() with array should produce type error');
    });

    it('should show error for substr() with invalid third parameter', async function() {
      const testContent = `
let text = "hello world";
substr(text, 0, "invalid");
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-invalid-length.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("integer") || d.message.includes("double"))
      );
      
      assert(substrErrors.length > 0, 'substr() with invalid length parameter should produce type error');
    });
  });

  describe('Mixed scenarios', function() {
    it('should NOT show errors for multiple valid substr function calls', async function() {
      const testContent = `
let text = "hello world";
let part1 = substr(text, 0, 5);
let part2 = substr(text, 6);
let part3 = substr("test string", 5, 3);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-mixed-valid.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("string") || d.message.includes("integer") || d.message.includes("double"))
      );
      
      assert.strictEqual(substrErrors.length, 0, 
        `Multiple valid substr function calls should not produce errors. Found: ${substrErrors.map(e => e.message).join(', ')}`);
    });

    it('should show errors for argument count violations', async function() {
      const testContent = `
let text = "hello";
substr();
substr(text);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-argument-count.uc');
      
      const argumentErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("expects") && (d.message.includes("argument") || d.message.includes("parameter")))
      );
      
      assert(argumentErrors.length >= 1, // At least 1 error expected
        `Should show errors for wrong argument counts. Found ${argumentErrors.length} errors: ${argumentErrors.map(e => e.message).join(', ')}`);
    });
  });

  describe('Integration with other features', function() {
    it('should work correctly with variable inference', async function() {
      const testContent = `
function extractSubstring(input, start, len) {
  if (typeof input === "string" && typeof start === "number") {
    if (len !== undefined && typeof len === "number") {
      return substr(input, start, len);
    }
    return substr(input, start);
  }
  return null;
}

let result = extractSubstring("hello world", 6, 5);
let result2 = extractSubstring("test", 1);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-integration.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("string") || d.message.includes("integer") || d.message.includes("double")) &&
        !d.message.includes("Undefined variable") // Allow undefined variable errors, just not type errors
      );
      
      assert.strictEqual(substrErrors.length, 0, 
        `Substr function should work correctly in complex scenarios. Found: ${substrErrors.map(e => e.message).join(', ')}`);
    });

    it('should handle literal values correctly', async function() {
      const testContent = `
let result1 = substr("hello world", 0, 5);
let result2 = substr("test string", 5);
let result3 = substr("example", 2.5, 3.7); // Double values should be accepted
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-substr-literals.uc');
      
      const substrErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("substr") &&
        (d.message.includes("string") || d.message.includes("integer") || d.message.includes("double"))
      );
      
      assert.strictEqual(substrErrors.length, 0, 
        `Substr with literal values should not produce type errors. Found: ${substrErrors.map(e => e.message).join(', ')}`);
    });
  });
});

// Export for test runner
module.exports = {
  name: 'Substr Function AST Validation',
  tests: 10
};