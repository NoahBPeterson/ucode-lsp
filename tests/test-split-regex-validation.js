const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Split Function Regex Support Tests', function() {
  this.timeout(10000);

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

  describe('Split Function Regex Pattern Support', function() {
    it('should accept string separator without errors', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, " ");
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-string.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for string separator');
    });

    it('should accept regex separator without errors', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, /\\s+/);
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-regex.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for regex separator');
    });

    it('should accept regex separator with limit parameter without errors', async function() {
      const testContent = `
let text = "hello world test example";
let words = split(text, /\\s+/, 2);
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-regex-limit.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for regex separator with limit');
    });

    it('should show error for number as separator', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, 123);
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-invalid.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects string or regex pattern as second argument") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 1, 'Should have exactly one type error for invalid separator');
      assert(typeErrors[0].message.includes('got integer'), 'Error message should mention getting integer');
    });

    it('should show error for array as separator', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, []);
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-array.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects string or regex pattern as second argument") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 1, 'Should have exactly one type error for array separator');
      assert(typeErrors[0].message.includes('got array'), 'Error message should mention getting array');
    });

    it('should show error for wrong limit parameter type', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, /\\s+/, "invalid");
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-bad-limit.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects integer as third argument") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 1, 'Should have exactly one type error for invalid limit');
      assert(typeErrors[0].message.includes('got string'), 'Error message should mention getting string');
    });

    it('should work with complex regex patterns', async function() {
      const testContent = `
let text = "word1:word2;word3,word4";
let words1 = split(text, /[;:,]/);
let words2 = split(text, /[;:,]/, 3);
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-complex-regex.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for complex regex patterns');
    });
  });

  describe('Consistency with Other Regex-Supporting Functions', function() {
    it('should handle regex consistently across split, match, and replace', async function() {
      const testContent = `
let text = "hello world test";
let pattern = /\\s+/;

// All these should work without type errors
let words = split(text, pattern);
let matches = match(text, pattern);
let replaced = replace(text, pattern, "_");
      `;

      const diagnostics = await getDiagnostics(testContent, '/tmp/test-regex-consistency.uc');

      const typeErrors = diagnostics.filter(d =>
        d.severity === 1 &&
        d.message.includes("expects") &&
        (d.message.includes("split") || d.message.includes("match") || d.message.includes("replace"))
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for any regex-supporting function');
    });
  });
});
