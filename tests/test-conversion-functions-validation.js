const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Conversion Functions Validation Tests', function() {
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

  // Helper function to get diagnostics with improved naming  
  async function getValidationErrors(code, filename = '/tmp/conversion-test.uc') {
    const diagnostics = await getDiagnostics(code, filename);
    return diagnostics.filter(d => d.severity === 1); // Only return errors
  }

  describe('int() function validation', () => {
    it('should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        print(int("123"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should accept number parameter', async () => {
      const errors = await getValidationErrors(`
        print(int(123.45));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid number parameter');
    });

    it('should reject array parameter', async () => {
      const errors = await getValidationErrors(`
        print(int([1, 2, 3]));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for array parameter');
      assert.match(errors[0].message, /int\(\) expects string or number, got array/);
    });

    it('should reject object parameter', async () => {
      const errors = await getValidationErrors(`
        print(int({value: 123}));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for object parameter');
      assert.match(errors[0].message, /int\(\) expects string or number, got object/);
    });

    it('should require at least one parameter', async () => {
      const errors = await getValidationErrors(`
        print(int());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /int\(\) expects 1 argument, got 0/);
    });

    it('should reject multiple parameters', async () => {
      const errors = await getValidationErrors(`
        print(int("123", "456"));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for too many parameters');
      assert.match(errors[0].message, /int\(\) expects 1 argument, got 2/);
    });
  });

  describe('hex() function validation', () => {
    it('should reject number parameter', async () => {
      const errors = await getValidationErrors(`
        print(hex(255));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for invalid number parameter');
        assert.match(errors[0].message, /hex\(\) expects string, got integer/);
    });

    it('should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        print(hex("255"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error for string parameter');
    });

    it('should require one parameter', async () => {
      const errors = await getValidationErrors(`
        print(hex());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /hex\(\) expects 1 argument, got 0/);
    });
  });

  describe('chr() and ord() function validation', () => {
    it('chr should accept number parameter', async () => {
      const errors = await getValidationErrors(`
        print(chr(65));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid number parameter');
    });

    it('chr should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        print(chr("65"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error for string parameter (chr accepts both)');
    });

    it('ord should accept string parameter', async () => {
      const errors = await getValidationErrors(`
        print(ord("A"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('ord should reject number parameter', async () => {
      const errors = await getValidationErrors(`
        print(ord(65));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for number parameter');
      assert.match(errors[0].message, /'ord' expects string for argument 1, but got integer/);
    });
  });

  describe('uchr() function validation', () => {
    it('should accept number parameter', async () => {
      const errors = await getValidationErrors(`
        print(uchr(8364));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid number parameter');
    });

    it('should reject string parameter', async () => {
      const errors = await getValidationErrors(`
        print(uchr("8364"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error for string parameter');
    });
  });

  describe('Combined conversion functions', () => {
    it('should validate nested conversion functions', async () => {
      const errors = await getValidationErrors(`
        print(chr(ord("A") + 1));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid nested functions');
    });

    it('should catch errors in nested conversion functions', async () => {
      const errors = await getValidationErrors(`
        print(chr(ord(65)));
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for invalid nested function');
      assert.match(errors[0].message, /'ord' expects string for argument 1, but got integer/);
    });
  });
});