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

  // Unique URI per call. The mocha LSP server is shared across all test files,
  // and a single didOpen produces TWO publishDiagnostics for its URI (an
  // immediate one from onDidOpen plus a 50ms-debounced one from
  // onDidChangeContent). getDiagnostics resolves on the next publish for the
  // URI with no version correlation, so when consecutive tests REUSE one URI a
  // delayed publish from the previous test can resolve the next test's waiter
  // (observed as a flaky `int()`-arg-count assertion). A distinct URI per call
  // isolates each waiter so only that test's own publishes can resolve it.
  let _uriSeq = 0;
  async function getValidationErrors(code, filename) {
    const uri = filename || `/tmp/conversion-test-${_uriSeq++}.uc`;
    const diagnostics = await getDiagnostics(code, uri);
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

    it('should accept array parameter (C returns NaN)', async () => {
      const errors = await getValidationErrors(`
        print(int([1, 2, 3]));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error — C accepts any type, returns NaN for arrays');
    });

    it('should accept object parameter (C returns NaN)', async () => {
      const errors = await getValidationErrors(`
        print(int({value: 123}));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error — C accepts any type, returns NaN for objects');
    });

    it('should require at least one parameter', async () => {
      const errors = await getValidationErrors(`
        print(int());
      `);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert(errors[0].message.includes('int'), 'Error should mention int');
    });

    it('should accept two parameters (2nd arg is optional base)', async () => {
      const errors = await getValidationErrors(`
        print(int("123", "456"));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error — 2nd arg is optional base');
    });
  });

  describe('hex() function validation', () => {
    it('should accept number parameter (C returns NaN for non-string)', async () => {
      const errors = await getValidationErrors(`
        print(hex(255));
      `);
      assert.strictEqual(errors.length, 0, 'Should not have error — C accepts it, returns NaN for non-string');
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
      assert(errors[0].message.includes('hex') && errors[0].message.includes('0'), 'Error should mention hex and 0');
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