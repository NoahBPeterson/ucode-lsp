// AST-based LSP integration test for object function validations
console.log('🧪 Running AST-based Object Function LSP Validation Tests...\n');

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Object Functions AST Validation Tests', function() {
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

  describe('keys() function validation', function() {
    it('should NOT show error for keys() with valid object parameter', async function() {
      const testContent = `
let obj = { name: "test", value: 123 };
keys(obj);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-keys-valid.uc');
      
      const keysErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("keys")
      );
      
      assert.strictEqual(keysErrors.length, 0, 
        `keys() with object should not produce errors. Found: ${keysErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for keys() with invalid string parameter', async function() {
      const testContent = `
let str = "hello";
keys(str);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-keys-string.uc');
      
      const keysErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("keys") &&
        d.message.includes("object")
      );
      
      assert(keysErrors.length > 0, 'keys() with string should produce type error');
    });

    it('should show error for keys() with invalid number parameter', async function() {
      const testContent = `
let num = 123;
keys(num);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-keys-number.uc');
      
      const keysErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("keys") &&
        d.message.includes("object")
      );
      
      assert(keysErrors.length > 0, 'keys() with number should produce type error');
    });
  });

  describe('values() function validation', function() {
    it('should NOT show error for values() with valid object parameter', async function() {
      const testContent = `
let obj = { a: 1, b: 2, c: 3 };
values(obj);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-values-valid.uc');
      
      const valuesErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("values")
      );
      
      assert.strictEqual(valuesErrors.length, 0, 
        `values() with object should not produce errors. Found: ${valuesErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for values() with invalid string parameter', async function() {
      const testContent = `
let str = "test";
values(str);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-values-string.uc');
      
      const valuesErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("values") &&
        d.message.includes("object")
      );
      
      assert(valuesErrors.length > 0, 'values() with string should produce type error');
    });

    it('should show error for values() with invalid array parameter', async function() {
      const testContent = `
let arr = [1, 2, 3];
values(arr);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-values-array.uc');
      
      const valuesErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("values") &&
        d.message.includes("object")
      );
      
      assert(valuesErrors.length > 0, 'values() with array should produce type error');
    });
  });

  describe('exists() function validation', function() {
    it('should NOT show error for exists() with valid parameters', async function() {
      const testContent = `
let obj = { name: "test", count: 5 };
exists(obj, "name");
exists(obj, "missing");
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-exists-valid.uc');
      
      const existsErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("exists")
      );
      
      assert.strictEqual(existsErrors.length, 0, 
        `exists() with valid parameters should not produce errors. Found: ${existsErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for exists() with invalid first parameter', async function() {
      const testContent = `
let str = "hello";
exists(str, "key");
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-exists-string.uc');
      
      const existsErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("exists") &&
        d.message.includes("object")
      );
      
      assert(existsErrors.length > 0, 'exists() with non-object first parameter should produce error');
    });

    it('should show error for exists() with invalid second parameter', async function() {
      const testContent = `
let obj = { test: true };
exists(obj, 123);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-exists-number-key.uc');
      
      const existsErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("exists") &&
        d.message.includes("string")
      );
      
      assert(existsErrors.length > 0, 'exists() with non-string second parameter should produce error');
    });
  });

  describe('Mixed object functions', function() {
    it('should NOT show errors for multiple valid object function calls', async function() {
      const testContent = `
let data = { users: ["alice", "bob"], count: 2 };
let userKeys = keys(data);
let userValues = values(data);
let hasUsers = exists(data, "users");
let hasAdmin = exists(data, "admin");
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-mixed-valid.uc');
      
      const objectFunctionErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("keys") || d.message.includes("values") || d.message.includes("exists"))
      );
      
      assert.strictEqual(objectFunctionErrors.length, 0, 
        `Multiple valid object function calls should not produce errors. Found: ${objectFunctionErrors.map(e => e.message).join(', ')}`);
    });

    it('should show errors for argument count violations', async function() {
      const testContent = `
let obj = { test: 1 };
keys();
values(obj, "extra");
exists(obj);
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-argument-count.uc');
      
      const argumentErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("expects") && (d.message.includes("argument") || d.message.includes("parameter")))
      );
      
      assert(argumentErrors.length >= 2, // At least 2 errors expected (keys() with no args, exists() with 1 arg)
        `Should show errors for wrong argument counts. Found ${argumentErrors.length} errors: ${argumentErrors.map(e => e.message).join(', ')}`);
    });
  });

  describe('Integration with other features', function() {
    it('should work correctly with variable inference', async function() {
      const testContent = `
function processData(input) {
  if (typeof input === "object") {
    let objKeys = keys(input);
    let objValues = values(input);
    return { keys: objKeys, values: objValues };
  }
  return null;
}

let result = processData({ a: 1, b: 2 });
if (exists(result, "keys")) {
  let keyCount = length(result.keys);
}
`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-integration.uc');
      
      const objectFunctionErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("keys") || d.message.includes("values") || d.message.includes("exists")) &&
        !d.message.includes("Undefined variable") // Allow undefined variable errors, just not type errors
      );
      
      assert.strictEqual(objectFunctionErrors.length, 0, 
        `Object functions should work correctly in complex scenarios. Found: ${objectFunctionErrors.map(e => e.message).join(', ')}`);
    });
  });
});

// Export for test runner
module.exports = {
  name: 'Object Functions AST Validation',
  tests: 12
};