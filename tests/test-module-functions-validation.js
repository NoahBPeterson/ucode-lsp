const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Module Functions Validation Tests', function() {
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

  // Helper function to get validation errors with improved naming
  async function getValidationErrors(code, filename) {
    // Use unique filename for each test if not provided
    if (!filename) {
      filename = `/tmp/module-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.uc`;
    }
    const diagnostics = await getDiagnostics(code, filename);
    return diagnostics.filter(d => d.severity === 1); // Only return errors
  }

  describe('require() function validation', () => {
    it('should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        let module = require("fs");
        print(module);
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject number parameter', async () => {
      const errors = await getValidationErrors(`
        print(require(123));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for number parameter');
      assert.match(errors[0].message, /require\(\) expects string, got (integer|number)/);
    });

    it('should reject array parameter', async () => {
      const errors = await getValidationErrors(`
        print(require(["fs"]));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for array parameter');
      assert.match(errors[0].message, /require\(\) expects string, got array/);
    });

    it('should require exactly one parameter', async () => {
      const errors = await getValidationErrors(`
        print(require());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /require\(\) expects 1 argument, got 0/);
    });

    it('should reject multiple parameters', async () => {
      const errors = await getValidationErrors(`
        print(require("fs", "extra"));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for multiple parameters');
      assert.match(errors[0].message, /require\(\) expects 1 argument, got 2/);
    });
  });

  describe('include() function validation', () => {
    it('should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        print(include("/path/to/file.uc"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject number parameter', async () => {
      const errors = await getValidationErrors(`
        print(include(42));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for number parameter');
      assert.match(errors[0].message, /include\(\) expects string, got (integer|number)/);
    });

    it('should require exactly one parameter', async () => {
      const errors = await getValidationErrors(`
        print(include());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /include\(\) expects 1 argument, got 0/);
    });
  });

  describe('loadfile() function validation', () => {
    it('should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        let func = loadfile("/path/to/script.uc");
        print(func);
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject object parameter', async () => {
      const errors = await getValidationErrors(`
        print(loadfile({path: "/path/to/script.uc"}));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for object parameter');
      assert.match(errors[0].message, /loadfile\(\) expects string, got object/);
    });

    it('should require exactly one parameter', async () => {
      const errors = await getValidationErrors(`
        print(loadfile());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /loadfile\(\) expects 1 argument, got 0/);
    });
  });

  describe('loadstring() function validation', () => {
    it('should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        let func = loadstring("print('Hello World');");
        print(func);
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject boolean parameter', async () => {
      const errors = await getValidationErrors(`
        print(loadstring(true));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for boolean parameter');
      assert.match(errors[0].message, /loadstring\(\) expects string, got boolean/);
    });

    it('should require exactly one parameter', async () => {
      const errors = await getValidationErrors(`
        print(loadstring());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /loadstring\(\) expects 1 argument, got 0/);
    });
  });

  describe('sourcepath() function validation', () => {
    it('should accept no parameters', async () => {
      const errors = await getValidationErrors(`
        let path = sourcepath();
        print(path);
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for no parameters');
    });

    it('should accept number depth parameter', async () => {
      const errors = await getValidationErrors(`
        print(sourcepath(1));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error for valid number depth parameter');
    });

    it('should accept convertible number depth parameter', async () => {
      const errors = await getValidationErrors(`
        print(sourcepath('1'));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error for valid number depth parameter');
    });

    it('should accept number depth and boolean dironly parameters', async () => {
      const errors = await getValidationErrors(`
        print(sourcepath(2, true));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error for valid parameters');
    });

    it('should reject string depth parameter', async () => {
      const errors = await getValidationErrors(`
        print(sourcepath("invalid"));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for invalid depth parameter type');
      assert.match(errors[0].message, /String "invalid" cannot be converted to a number for sourcepath\(\) argument 1/);
    });

    it('should accept various types for dironly parameter', async () => {
      const validDironlyCases = [
        'true', 'false', '1', '0', '"true"', '""', 'null', '{}', '[]'
      ];

      for (const val of validDironlyCases) {
        const errors = await getValidationErrors(`print(sourcepath(1, ${val}));`);
        assert.strictEqual(errors.length, 0, `Should not have error for dironly value: ${val}`);
      }
    });

    
  });

  describe('Combined module functions', () => {
    it('should validate multiple module functions in one script', async () => {
      const errors = await getValidationErrors(`
        let fs = require("fs");
        let path = sourcepath();
        let code = "print('test');";
        let func = loadstring(code);
        print(fs, path, func);
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid usage');
    });

    it('should catch errors in invalid module functions - require', async () => {
      const errors = await getValidationErrors(`let fs = require(123);`);
      assert.strictEqual(errors.length, 1, 'Should have error for require()');
      assert.match(errors[0].message, /require\(\) expects string, got (integer|number)/);
    });

    it('should catch errors in invalid module functions - loadstring', async () => {
      const errors = await getValidationErrors(`let func = loadstring(true);`);
      assert.strictEqual(errors.length, 1, 'Should have error for loadstring()');
      assert.match(errors[0].message, /loadstring\(\) expects string, got boolean/);
    });

    it('should catch errors in invalid module functions - sourcepath', async () => {
      const errors = await getValidationErrors(`let path = sourcepath("invalid");`);
      assert.strictEqual(errors.length, 1, 'Should have error for sourcepath()');
      assert.match(errors[0].message, /String "invalid" cannot be converted to a number/);
    });

    it('should validate nested module function calls', async () => {
      const errors = await getValidationErrors(`
        let func = loadstring("print(sourcepath());");
        print(func);
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid nested calls');
    });
  });
});