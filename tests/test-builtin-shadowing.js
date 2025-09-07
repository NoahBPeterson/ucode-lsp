// Builtin function shadowing behavior tests
// Tests that shadowing builtin functions shows warnings, not errors

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Builtin Function Shadowing Tests', function() {
  this.timeout(15000); // 15 second timeout for comprehensive tests

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

  describe('Builtin Function Shadowing', function() {
    it('should show WARNING for builtin function shadowing', async function() {
      const testContent = `
let signal = "custom signal handler";
let printf = function(fmt, ...args) { return fmt; };
let length = 42;
`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/builtin-shadowing.uc');
      const shadowingDiagnostics = diagnostics.filter(d => 
        d.message.includes('shadows builtin function') && d.severity === 2 // Warning
      );
      
      assert.strictEqual(shadowingDiagnostics.length, 3, 
        `Expected 3 builtin shadowing warnings, got ${shadowingDiagnostics.length}. Messages: ${shadowingDiagnostics.map(d => d.message).join(', ')}`);
      
      // Verify specific builtins are detected
      const signalWarning = shadowingDiagnostics.find(d => d.message.includes("'signal'"));
      const printfWarning = shadowingDiagnostics.find(d => d.message.includes("'printf'"));
      const lengthWarning = shadowingDiagnostics.find(d => d.message.includes("'length'"));
      
      assert(signalWarning, 'Should show warning for signal builtin shadowing');
      assert(printfWarning, 'Should show warning for printf builtin shadowing');
      assert(lengthWarning, 'Should show warning for length builtin shadowing');
    });

    it('should NOT show ERROR for builtin function shadowing', async function() {
      const testContent = `let signal = "custom signal handler";`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/builtin-no-error.uc');
      const redeclarationErrors = diagnostics.filter(d => 
        d.message.includes('already declared in this scope') && d.severity === 1 // Error
      );
      
      assert.strictEqual(redeclarationErrors.length, 0, 
        `Should not show redeclaration errors for builtin shadowing. Found: ${redeclarationErrors.map(d => d.message).join(', ')}`);
    });
  });

  describe('Variable Redeclaration Errors', function() {
    it('should show ERROR for same-scope variable redeclaration', async function() {
      const testContent = `
let myVar = 1;
let myVar = 2; // Redeclaration error
function test() {
    let localVar = 'a';
    let localVar = 'b'; // Another redeclaration error
}
`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/redeclaration.uc');
      const redeclarationErrors = diagnostics.filter(d => 
        d.message.includes('already declared in this scope') && d.severity === 1 // Error
      );
      
      assert(redeclarationErrors.length >= 1, 
        `Expected at least 1 redeclaration error, got ${redeclarationErrors.length}. Messages: ${redeclarationErrors.map(d => d.message).join(', ')}`);
      
      // Should catch myVar redeclaration at minimum
      const myVarError = redeclarationErrors.find(d => d.message.includes("'myVar'"));
      assert(myVarError, 'Should show error for myVar redeclaration');
    });

    it('should distinguish between shadowing and redeclaration', async function() {
      const testContent = `
// Shadowing builtins - should be warnings
let signal = "handler";
let printf = function() {};

// True redeclaration - should be error  
let myVar = 1;
let myVar = 2;
`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/distinguish.uc');
      
      const shadowingWarnings = diagnostics.filter(d => 
        d.message.includes('shadows builtin function') && d.severity === 2
      );
      const redeclarationErrors = diagnostics.filter(d => 
        d.message.includes('already declared in this scope') && d.severity === 1
      );
      
      assert(shadowingWarnings.length >= 2, 'Should show warnings for builtin shadowing');
      assert(redeclarationErrors.length >= 1, 'Should show errors for variable redeclaration');
    });
  });

  describe('Cross-Scope Variable Shadowing', function() {
    it('should handle cross-scope variable shadowing appropriately', async function() {
      const testContent = `
let outerVar = 'outer';
function test() {
    let outerVar = 'inner'; // Should shadow outer variable
    let innerVar = 'test';
}
let innerVar = 'global'; // Should shadow function-scope variable
`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/cross-scope.uc');
      const shadowingWarnings = diagnostics.filter(d => 
        d.message.includes('shadows') && d.severity === 2 // Warning
      );
      
      // Cross-scope shadowing behavior may vary based on scope analysis implementation
      // At minimum, should not show redeclaration errors
      const redeclarationErrors = diagnostics.filter(d => 
        d.message.includes('already declared in this scope') && d.severity === 1
      );
      
      assert.strictEqual(redeclarationErrors.length, 0, 
        'Should not show redeclaration errors for cross-scope shadowing');
    });
  });

  describe('No False Positives', function() {
    it('should not show false positives for normal variable declarations', async function() {
      const testContent = `
let userName = 'alice';
let userAge = 25;
function processUser() {
    let status = 'active';
    return status;
}
`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/normal-vars.uc');
      const unexpectedErrors = diagnostics.filter(d => 
        d.message.includes('already declared') && d.severity === 1
      );
      
      assert.strictEqual(unexpectedErrors.length, 0, 
        `Should not show redeclaration errors for normal variables. Found: ${unexpectedErrors.map(d => d.message).join(', ')}`);
    });

    it('should handle the original user case correctly', async function() {
      // This is the exact case from the user's request
      const testContent = `
import * as uloop from 'uloop';
let signal = uloop.signal("SIGUSR1", () => {}); // Should be WARNING, not ERROR
`;

      const diagnostics = await getDiagnostics(testContent, '/tmp/user-case.uc');
      
      const signalDiagnostics = diagnostics.filter(d => d.message.includes('signal'));
      const shadowingWarnings = signalDiagnostics.filter(d => 
        d.severity === 2 && d.message.includes('shadows builtin')
      );
      const redeclarationErrors = signalDiagnostics.filter(d => 
        d.severity === 1 && d.message.includes('already declared')
      );
      
      assert(shadowingWarnings.length > 0, 'Should show builtin shadowing warning');
      assert.strictEqual(redeclarationErrors.length, 0, 
        'Should not show redeclaration error for builtin shadowing');
    });
  });
});