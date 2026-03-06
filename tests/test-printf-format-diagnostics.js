const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('printf/sprintf Format String Diagnostics', function() {
  this.timeout(15000);

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

  async function getWarnings(code, filename = '/tmp/printf-test.uc') {
    const diagnostics = await getDiagnostics(code, filename);
    return diagnostics.filter(d => d.severity === 2); // DiagnosticSeverity.Warning = 2
  }

  async function getAllDiagnostics(code, filename = '/tmp/printf-test.uc') {
    const diagnostics = await getDiagnostics(code, filename);
    return diagnostics;
  }

  describe('printf() type mismatch', () => {
    it('should warn when passing string to %d', async () => {
      const warnings = await getWarnings(`
        printf("%d", "hello");
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('%d'));
      assert.strictEqual(fmtWarnings.length, 1, 'Should have 1 type mismatch warning');
      assert.match(fmtWarnings[0].message, /type.*string.*%d/i);
    });

    it('should not warn for correct types', async () => {
      const warnings = await getWarnings(`
        printf("%d %s %f", 1, "x", 3.14);
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('printf'));
      assert.strictEqual(fmtWarnings.length, 0, 'Should have no format warnings for correct usage');
    });
  });

  describe('printf() argument count', () => {
    it('should warn when too few arguments', async () => {
      const warnings = await getWarnings(`
        printf("%s %s", "a");
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('specifier'));
      assert.strictEqual(fmtWarnings.length, 1, 'Should have 1 count mismatch warning');
      assert.match(fmtWarnings[0].message, /2 specifier.*1 argument/);
    });

    it('should warn when too many arguments', async () => {
      const warnings = await getWarnings(`
        printf("%s", "a", "b");
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('specifier'));
      assert.strictEqual(fmtWarnings.length, 1, 'Should have 1 count mismatch warning');
      assert.match(fmtWarnings[0].message, /1 specifier.*2 argument/);
    });
  });

  describe('printf() no false positives', () => {
    it('should not warn for format string with no specifiers', async () => {
      const warnings = await getWarnings(`
        printf("no specifiers");
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('printf'));
      assert.strictEqual(fmtWarnings.length, 0);
    });

    it('should not warn for escaped percent %%', async () => {
      const warnings = await getWarnings(`
        printf("100%%");
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('printf'));
      assert.strictEqual(fmtWarnings.length, 0);
    });

    it('should not warn for %J (ucode-specific, any type)', async () => {
      const warnings = await getWarnings(`
        let obj = { a: 1 };
        printf("%J", obj);
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('%J'));
      assert.strictEqual(fmtWarnings.length, 0);
    });

    it('should not warn for width/precision modifiers', async () => {
      const warnings = await getWarnings(`
        printf("%5.2f", 3.14);
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('printf'));
      assert.strictEqual(fmtWarnings.length, 0);
    });

    it('should not warn for unknown type variables', async () => {
      const warnings = await getWarnings(`
        printf("%d", unknownVar);
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('%d'));
      assert.strictEqual(fmtWarnings.length, 0, 'Should not flag unknown types');
    });
  });

  describe('sprintf() format diagnostics', () => {
    it('should warn on type mismatch same as printf', async () => {
      const warnings = await getWarnings(`
        let result = sprintf("%d", "hello");
      `);
      const fmtWarnings = warnings.filter(w => w.message.includes('%d'));
      assert.strictEqual(fmtWarnings.length, 1, 'sprintf should also check format types');
      assert.match(fmtWarnings[0].message, /sprintf/);
    });
  });
});
