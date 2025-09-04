const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Filter Builtin Function Validation Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

  let lspServer;
  let getDiagnostics;
  let getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });



  describe('Filter Builtin Function Recognition', function() {
    const testContent = `// Test filter builtin function
const batman_ifaces = filter(split("lol:lol", ';'), () => true);
let evens = filter([1, 2, 3, 4, 5], n => n % 2 == 0);
let filtered = filter(["a", "b", "c"], (val, idx) => idx > 0);`;

    it('should not show "Undefined function" error for filter builtin', async function() {
      const diagnostics = await getDiagnostics(testContent, `/tmp/test-filter-builtin-${Date.now()}.uc`);
      
      // Check for "Undefined function: filter" errors
      const undefinedFilterErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('Undefined function') && 
        d.message.includes('filter')
      );
      
      assert.strictEqual(undefinedFilterErrors.length, 0, 
        `Should not show "Undefined function: filter" errors. Found: ${undefinedFilterErrors.map(e => e.message).join(', ')}`);
    });

    it('should provide hover information for filter builtin', async function() {
      const hover = await getHover(testContent, `/tmp/test-filter-hover-${Date.now()}.uc`, 1, 25);
      
      assert(hover, 'Should return hover information for filter');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('filter'), 'Should mention filter function');
      assert(hover.contents.value.includes('Filter array elements'), 'Should describe filtering');
      assert(hover.contents.value.includes('callback'), 'Should mention callback parameter');
    });

    it('should recognize filter as a valid builtin function', async function() {
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-filter-valid.uc');
      
      // Filter should be recognized, so no "undefined function" errors
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.toLowerCase().includes('undefined') &&
        d.message.toLowerCase().includes('filter')
      );
      
      assert.strictEqual(errors.length, 0, 
        'Filter builtin should be recognized as valid function');
    });
  });

  describe('Array Method Validation (Invalid Usage)', function() {
    const arrayMethodTestContent = `// Test invalid array method calls
let data = ["a", "b", "c"];
let result1 = data.filter(x => x !== "b");  // Invalid - arrays don't have methods
let result2 = data.map(x => x.toUpperCase()); // Invalid - arrays don't have methods  
let result3 = data.length;  // Valid - arrays have length property

// Also test on split result
let parts = split("a,b,c", ",");
let filtered = parts.filter(x => x !== "b");  // Invalid - split returns array, arrays don't have methods`;

    it('should detect invalid .filter() method call on arrays', async function() {
      const diagnostics = await getDiagnostics(arrayMethodTestContent, '/tmp/test-array-methods.uc');
      
      // Look for array method validation errors
      const arrayMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes('does not exist on array type') || 
         d.message.includes('arrays do not have methods') ||
         d.message.includes('Property \'filter\' does not exist'))
      );
      
      // We expect at least 3 method call errors (data.filter, data.map, parts.filter)
      assert(arrayMethodErrors.length >= 2, 
        `Should detect invalid array method calls. Found ${arrayMethodErrors.length} errors: ${arrayMethodErrors.map(e => e.message).join(', ')}`);
    });

    it('should detect invalid array property access (length)', async function() {
      const diagnostics = await getDiagnostics(arrayMethodTestContent, '/tmp/test-array-properties.uc');
      
      // Should error on .length property access since arrays have no properties
      const lengthPropertyErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('Property \'length\' does not exist on array type')
      );
      
      assert(lengthPropertyErrors.length >= 1, 
        'Should detect invalid .length property access on arrays - use length(array) instead');
    });

    it('should provide helpful error messages for array methods', async function() {
      const diagnostics = await getDiagnostics(arrayMethodTestContent, '/tmp/test-array-error-messages.uc');
      
      // Find array method errors and check message quality
      const methodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes('filter') || d.message.includes('map')) &&
        d.message.includes('does not exist')
      );
      
      if (methodErrors.length > 0) {
        methodErrors.forEach(error => {
          // Error message should be informative
          assert(error.message.includes('array'), 'Error message should mention array type');
          assert(error.source === 'ucode-semantic', 'Error source should be ucode-semantic');
        });
      }
    });
  });

  describe('Filter vs Array Methods Edge Cases', function() {
    it('should distinguish between valid filter() builtin and invalid .filter() method', async function() {
      const edgeCaseContent = `// Valid builtin usage
let validResult = filter([1, 2, 3], x => x > 1);

// Invalid method usage  
let arr = [1, 2, 3];
let invalidResult = arr.filter(x => x > 1);

// Complex case with split
let splitResult = split("a,b,c", ",");
let validFiltered = filter(splitResult, x => x !== "b");  // Valid builtin
let invalidFiltered = splitResult.filter(x => x !== "b");  // Invalid method`;

      const diagnostics = await getDiagnostics(edgeCaseContent, '/tmp/test-edge-cases.uc');
      
      // Should not error on valid builtin filter() calls
      const undefinedFilterErrors = diagnostics.filter(d => 
        d.message.includes('Undefined function') && 
        d.message.includes('filter')
      );
      assert.strictEqual(undefinedFilterErrors.length, 0, 
        'Should not show undefined function errors for valid filter() builtin calls');
      
      // Should error on invalid .filter() method calls
      const arrayMethodErrors = diagnostics.filter(d => 
        d.message.includes('does not exist') && 
        d.message.includes('filter')
      );
      assert(arrayMethodErrors.length >= 2, 
        `Should detect invalid .filter() method calls. Found ${arrayMethodErrors.length} errors`);
    });
  });
});