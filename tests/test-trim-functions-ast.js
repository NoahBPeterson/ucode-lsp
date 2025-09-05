// AST-based LSP integration test for trim function validations
console.log('🧪 Running AST-based Trim Function LSP Validation Tests...\n');

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Trim Functions AST Validation Tests', function() {
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

  describe('trim() function validation', function() {
    it('should NOT show error for trim() with valid string parameter', async function() {
      const testContent = `
let text = "  hello world  ";
trim(text);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-trim-valid.uc');
      
      const trimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("trim") &&
        d.message.includes("string")
      );
      
      assert.strictEqual(trimErrors.length, 0, 
        `trim() with string should not produce errors. Found: ${trimErrors.map(e => e.message).join(', ')}`);
    });

    it('should NOT show error for trim() with two string parameters', async function() {
      const testContent = `
let text = "  hello world  ";
let chars = " ";
trim(text, chars);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-trim-two-params.uc');
      
      const trimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("trim") &&
        d.message.includes("string")
      );
      
      assert.strictEqual(trimErrors.length, 0, 
        `trim() with two strings should not produce errors. Found: ${trimErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for trim() with invalid number parameter', async function() {
      const testContent = `
let num = 123;
trim(num);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-trim-number.uc');
      
      const trimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("trim") &&
        d.message.includes("string")
      );
      
      assert(trimErrors.length > 0, 'trim() with number should produce type error');
    });

    it('should show error for trim() with invalid array parameter', async function() {
      const testContent = `
let arr = ["hello"];
trim(arr);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-trim-array.uc');
      
      const trimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("trim") &&
        d.message.includes("string")
      );
      
      assert(trimErrors.length > 0, 'trim() with array should produce type error');
    });
  });

  describe('ltrim() function validation', function() {
    it('should NOT show error for ltrim() with valid string parameter', async function() {
      const testContent = `
let text = "  hello world";
ltrim(text);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-ltrim-valid.uc');
      
      const ltrimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("ltrim") &&
        d.message.includes("string")
      );
      
      assert.strictEqual(ltrimErrors.length, 0, 
        `ltrim() with string should not produce errors. Found: ${ltrimErrors.map(e => e.message).join(', ')}`);
    });

    it('should NOT show error for ltrim() with two string parameters', async function() {
      const testContent = `
let text = "###hello world";
let chars = "#";
ltrim(text, chars);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-ltrim-two-params.uc');
      
      const ltrimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("ltrim") &&
        d.message.includes("string")
      );
      
      assert.strictEqual(ltrimErrors.length, 0, 
        `ltrim() with two strings should not produce errors. Found: ${ltrimErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for ltrim() with invalid number parameter', async function() {
      const testContent = `
let num = 456;
ltrim(num);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-ltrim-number.uc');
      
      const ltrimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("ltrim") &&
        d.message.includes("string")
      );
      
      assert(ltrimErrors.length > 0, 'ltrim() with number should produce type error');
    });
  });

  describe('rtrim() function validation', function() {
    it('should NOT show error for rtrim() with valid string parameter', async function() {
      const testContent = `
let text = "hello world  ";
rtrim(text);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtrim-valid.uc');
      
      const rtrimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("rtrim") &&
        d.message.includes("string")
      );
      
      assert.strictEqual(rtrimErrors.length, 0, 
        `rtrim() with string should not produce errors. Found: ${rtrimErrors.map(e => e.message).join(', ')}`);
    });

    it('should NOT show error for rtrim() with two string parameters', async function() {
      const testContent = `
let text = "hello world###";
let chars = "#";
rtrim(text, chars);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtrim-two-params.uc');
      
      const rtrimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("rtrim") &&
        d.message.includes("string")
      );
      
      assert.strictEqual(rtrimErrors.length, 0, 
        `rtrim() with two strings should not produce errors. Found: ${rtrimErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for rtrim() with invalid object parameter', async function() {
      const testContent = `
let obj = { text: "hello" };
rtrim(obj);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtrim-object.uc');
      
      const rtrimErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("rtrim") &&
        d.message.includes("string")
      );
      
      assert(rtrimErrors.length > 0, 'rtrim() with object should produce type error');
    });
  });

  describe('Mixed trim functions', function() {
    it('should NOT show errors for multiple valid trim function calls', async function() {
      const testContent = `
let text = "  hello world  ";
let leftTrimmed = ltrim(text);
let rightTrimmed = rtrim(text);
let bothTrimmed = trim(text);
let customTrim = trim(text, " h");
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-mixed-trim-valid.uc');
      
      const trimFunctionErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("trim") || d.message.includes("ltrim") || d.message.includes("rtrim")) &&
        d.message.includes("string")
      );
      
      assert.strictEqual(trimFunctionErrors.length, 0, 
        `Multiple valid trim function calls should not produce errors. Found: ${trimFunctionErrors.map(e => e.message).join(', ')}`);
    });

    it('should show errors for argument count violations', async function() {
      const testContent = `
let text = "hello";
trim();
ltrim(text, " ", "extra");
rtrim();
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-trim-argument-count.uc');
      
      const argumentErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("expects") && (d.message.includes("argument") || d.message.includes("parameter")))
      );
      
      assert(argumentErrors.length >= 2, // At least 2 errors expected
        `Should show errors for wrong argument counts. Found ${argumentErrors.length} errors: ${argumentErrors.map(e => e.message).join(', ')}`);
    });
  });

  describe('Integration with other features', function() {
    it('should work correctly with variable inference', async function() {
      const testContent = `
function processText(input) {
  if (typeof input === "string") {
    let trimmed = trim(input);
    let leftTrimmed = ltrim(input);
    let rightTrimmed = rtrim(input);
    return { trimmed, leftTrimmed, rightTrimmed };
  }
  return null;
}

let result = processText("  hello world  ");
if (result !== null) {
  let final = trim(result.trimmed, " ");
}
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-trim-integration.uc');
      
      const trimFunctionErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("trim") || d.message.includes("ltrim") || d.message.includes("rtrim")) &&
        d.message.includes("string") &&
        !d.message.includes("Undefined variable") // Allow undefined variable errors, just not type errors
      );
      
      assert.strictEqual(trimFunctionErrors.length, 0, 
        `Trim functions should work correctly in complex scenarios. Found: ${trimFunctionErrors.map(e => e.message).join(', ')}`);
    });
  });
});

// Export for test runner
module.exports = {
  name: 'Trim Functions AST Validation',
  tests: 12
};