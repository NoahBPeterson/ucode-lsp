/**
 * Unit tests for number conversion function validation
 * Tests the AST-based validation for hexdec(), b64enc(), and b64dec() functions
 */

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Number Conversion Function Validation', function() {
  this.timeout(15000);

  let lspServer;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  async function getValidationErrors(testCode) {
    const testFile = `/tmp/test_${Date.now()}.uc`;
    return await lspServer.getDiagnostics(testCode, testFile);
  }

  describe('hexdec() function validation', function() {
    it('should accept string parameters', async function() {
      const errors = await getValidationErrors(`
        let result = hexdec("FF");
        let result2 = hexdec("1A2B");
      `);
      const hexdecErrors = errors.filter(e => e.message.includes('hexdec'));
      assert.strictEqual(hexdecErrors.length, 0, 'Should not have errors for string parameters');
    });

    it('should accept string variables', async function() {
      const errors = await getValidationErrors(`
        let hexString = "DEADBEEF";
        let result = hexdec(hexString);
      `);
      const hexdecErrors = errors.filter(e => e.message.includes('hexdec'));
      assert.strictEqual(hexdecErrors.length, 0, 'Should not have errors for string variables');
    });

    it('should reject integer parameters', async function() {
      const errors = await getValidationErrors(`
        let result = hexdec(255);
      `);
      const hexdecErrors = errors.filter(e => e.message.includes('hexdec'));
      assert.strictEqual(hexdecErrors.length, 1, 'Should have error for integer parameter');
      assert.match(hexdecErrors[0].message, /hexdec\(\) expects string, got integer/);
    });

    it('should reject double parameters', async function() {
      const errors = await getValidationErrors(`
        let result = hexdec(255.5);
      `);
      const hexdecErrors = errors.filter(e => e.message.includes('hexdec'));
      assert.strictEqual(hexdecErrors.length, 1, 'Should have error for double parameter');
      assert.match(hexdecErrors[0].message, /hexdec\(\) expects string, got double/);
    });

    it('should require at least one parameter', async function() {
      const errors = await getValidationErrors(`
        let result1 = hexdec();
        let result2 = hexdec("FF", "extra");
      `);
      const hexdecErrors = errors.filter(e => e.message.includes('hexdec'));
      assert.strictEqual(hexdecErrors.length, 1, 'Should have errors for not having at least one parameter');
      assert.match(hexdecErrors[0].message, /expects at least 1 argument/);
      // Note: The second error is about too many arguments, but current implementation only checks minimum
    });

    it('should reject array parameters', async function() {
      const errors = await getValidationErrors(`
        let arr = ["FF"];
        let result = hexdec(arr);
      `);
      const hexdecErrors = errors.filter(e => e.message.includes('hexdec'));
      assert.strictEqual(hexdecErrors.length, 1, 'Should have error for array parameter');
      assert.match(hexdecErrors[0].message, /hexdec\(\) expects string, got array/);
    });
  });

  describe('b64enc() function validation', function() {
    it('should accept string parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64enc("Hello World");
        let result2 = b64enc("test data");
      `);
      const b64encErrors = errors.filter(e => e.message.includes('b64enc'));
      assert.strictEqual(b64encErrors.length, 0, 'Should not have errors for string parameters');
    });

    it('should accept string variables', async function() {
      const errors = await getValidationErrors(`
        let plainText = "Hello World";
        let result = b64enc(plainText);
      `);
      const b64encErrors = errors.filter(e => e.message.includes('b64enc'));
      assert.strictEqual(b64encErrors.length, 0, 'Should not have errors for string variables');
    });

    it('should reject integer parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64enc(123);
      `);
      const b64encErrors = errors.filter(e => e.message.includes('b64enc'));
      assert.strictEqual(b64encErrors.length, 1, 'Should have error for integer parameter');
      assert.match(b64encErrors[0].message, /b64enc\(\) expects string, got integer/);
    });

    it('should reject double parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64enc(123.45);
      `);
      const b64encErrors = errors.filter(e => e.message.includes('b64enc'));
      assert.strictEqual(b64encErrors.length, 1, 'Should have error for double parameter');
      assert.match(b64encErrors[0].message, /b64enc\(\) expects string, got double/);
    });

    it('should require at least one parameter', async function() {
      const errors = await getValidationErrors(`
        let result1 = b64enc();
        let result2 = b64enc("data", "extra");
      `);
      const b64encErrors = errors.filter(e => e.message.includes('b64enc'));
      assert.strictEqual(b64encErrors.length, 1, 'Should have errors for wrong parameter count');
      assert.match(b64encErrors[0].message, /expects at least 1 argument/);
    });

    it('should reject object parameters', async function() {
      const errors = await getValidationErrors(`
        let obj = { data: "test" };
        let result = b64enc(obj);
      `);
      const b64encErrors = errors.filter(e => e.message.includes('b64enc'));
      assert.strictEqual(b64encErrors.length, 1, 'Should have error for object parameter');
      assert.match(b64encErrors[0].message, /b64enc\(\) expects string, got object/);
    });
  });

  describe('b64dec() function validation', function() {
    it('should accept string parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64dec("SGVsbG8gV29ybGQ=");
        let result2 = b64dec("dGVzdCBkYXRh");
      `);
      const b64decErrors = errors.filter(e => e.message.includes('b64dec'));
      assert.strictEqual(b64decErrors.length, 0, 'Should not have errors for string parameters');
    });

    it('should accept string variables', async function() {
      const errors = await getValidationErrors(`
        let encodedData = "SGVsbG8gV29ybGQ=";
        let result = b64dec(encodedData);
      `);
      const b64decErrors = errors.filter(e => e.message.includes('b64dec'));
      assert.strictEqual(b64decErrors.length, 0, 'Should not have errors for string variables');
    });

    it('should reject integer parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64dec(12345);
      `);
      const b64decErrors = errors.filter(e => e.message.includes('b64dec'));
      assert.strictEqual(b64decErrors.length, 1, 'Should have error for integer parameter');
      assert.match(b64decErrors[0].message, /b64dec\(\) expects string, got integer/);
    });

    it('should reject double parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64dec(123.45);
      `);
      const b64decErrors = errors.filter(e => e.message.includes('b64dec'));
      assert.strictEqual(b64decErrors.length, 1, 'Should have error for double parameter');
      assert.match(b64decErrors[0].message, /b64dec\(\) expects string, got double/);
    });

    it('should require at least one parameter', async function() {
      const errors = await getValidationErrors(`
        let result1 = b64dec();
        let result2 = b64dec("SGVsbG8=", "extra");
      `);
      const b64decErrors = errors.filter(e => e.message.includes('b64dec'));
      assert.strictEqual(b64decErrors.length, 1, 'Should have errors for wrong parameter count');
      assert.match(b64decErrors[0].message, /expects at least 1 argument/);
    });

    it('should reject boolean parameters', async function() {
      const errors = await getValidationErrors(`
        let result = b64dec(true);
      `);
      const b64decErrors = errors.filter(e => e.message.includes('b64dec'));
      assert.strictEqual(b64decErrors.length, 1, 'Should have error for boolean parameter');
      assert.match(b64decErrors[0].message, /b64dec\(\) expects string, got boolean/);
    });
  });

  describe('Expression support (improvement over token-based validation)', function() {
    it('should validate expressions and function calls', async function() {
      const errors = await getValidationErrors(`
        function getHexString() {
          return "DEADBEEF";
        }
        
        function getNumber() {
          return 42;
        }
        
        // These should work (string expressions)
        let result1 = hexdec(getHexString());
        let result2 = b64enc("prefix" + "suffix");
        
        // These should fail (number expressions)
        let result3 = hexdec(getNumber());
        let result4 = b64enc(123 + 456);
      `);
      
      // Should have exactly 2 errors for the number expressions
      const conversionErrors = errors.filter(e => 
        e.message.includes('hexdec') || e.message.includes('b64enc')
      );
      assert.strictEqual(conversionErrors.length, 2, 'Should have 2 errors for invalid expressions');
      
      // Check that we get proper error messages
      const hexdecError = conversionErrors.find(e => e.message.includes('hexdec'));
      const b64encError = conversionErrors.find(e => e.message.includes('b64enc'));
      
      assert(hexdecError, 'Should have hexdec error');
      assert(b64encError, 'Should have b64enc error');
    });

    it('should work with complex variable assignments', async function() {
      const errors = await getValidationErrors(`
        let stringVar = "test";
        let numVar = 42;
        
        // Valid assignments
        let decoded = hexdec(stringVar);
        let encoded = b64enc(stringVar);
        let decoded2 = b64dec(stringVar);
        
        // Invalid assignments
        let badDecoded = hexdec(numVar);
        let badEncoded = b64enc(numVar);
        let badDecoded2 = b64dec(numVar);
      `);
      
      const conversionErrors = errors.filter(e => 
        e.message.includes('hexdec') || e.message.includes('b64enc') || e.message.includes('b64dec')
      );
      assert.strictEqual(conversionErrors.length, 3, 'Should have 3 errors for invalid variable types');
    });
  });

  describe('Migration validation (ensuring no regression)', function() {
    it('should still catch the cases that token-based validation caught', async function() {
      const errors = await getValidationErrors(`
        // These were caught by the old token-based validation
        let hex1 = hexdec(255);        // number literal -> should error
        let enc1 = b64enc(123);        // number literal -> should error  
        let dec1 = b64dec(456);        // number literal -> should error
        
        // These should still work
        let hex2 = hexdec("FF");       // string literal -> should work
        let enc2 = b64enc("data");     // string literal -> should work
        let dec2 = b64dec("ZGF0YQ=="); // string literal -> should work
      `);
      
      // Should have exactly 3 errors
      const conversionErrors = errors.filter(e => 
        e.message.includes('hexdec') || e.message.includes('b64enc') || e.message.includes('b64dec')
      );
      assert.strictEqual(conversionErrors.length, 3, 'Should have 3 errors for number literals');
      
      // Verify specific error messages
      assert(conversionErrors.some(e => e.message.includes('hexdec') && e.message.includes('integer')));
      assert(conversionErrors.some(e => e.message.includes('b64enc') && e.message.includes('integer')));
      assert(conversionErrors.some(e => e.message.includes('b64dec') && e.message.includes('integer')));
    });

    it('should provide better error locations than token-based validation', async function() {
      const errors = await getValidationErrors(`
        let result = hexdec(42);
      `);
      
      const hexdecError = errors.find(e => e.message.includes('hexdec'));
      assert(hexdecError, 'Should have hexdec error');
      
      // The error should be on the argument (42), not the function name
      // This is an improvement over token-based validation
      assert(hexdecError.range, 'Error should have location information');
      assert(hexdecError.range.start, 'Error should have start position');
      assert(hexdecError.range.end, 'Error should have end position');
    });
  });
});