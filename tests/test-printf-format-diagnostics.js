const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('printf/sprintf Format String Diagnostics', function() {
  this.timeout(15000);

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

  describe('printf() format specifier hover', () => {
    it('should show hover for %d specifier', async () => {
      // Code: printf("%d", 42);
      // Line 0:        ^-- %d starts at col 8, 'd' at col 9
      const code = 'printf("%d", 42);';
      const hover = await getHover(code, '/tmp/printf-hover.uc', 0, 9);
      assert.ok(hover, 'Should return hover for %d');
      assert.ok(hover.contents.value.includes('integer'), `Hover should mention integer, got: ${hover.contents.value}`);
      assert.ok(hover.contents.value.includes('%d'), 'Hover should show the specifier');
    });

    it('should show hover for %5.2f with width/precision info', async () => {
      // Code: printf("%5.2f", 3.14);
      // Line 0:        ^-- %5.2f starts at col 8
      const code = 'printf("%5.2f", 3.14);';
      const hover = await getHover(code, '/tmp/printf-hover2.uc', 0, 9);
      assert.ok(hover, 'Should return hover for %5.2f');
      assert.ok(hover.contents.value.includes('Width'), `Hover should include Width, got: ${hover.contents.value}`);
      assert.ok(hover.contents.value.includes('Precision'), `Hover should include Precision, got: ${hover.contents.value}`);
      assert.ok(hover.contents.value.includes('5'), 'Hover should show width value');
      assert.ok(hover.contents.value.includes('2'), 'Hover should show precision value');
    });

    it('should show hover for %J (ucode-specific)', async () => {
      // Code: printf("%J", obj);
      const code = 'printf("%J", obj);';
      const hover = await getHover(code, '/tmp/printf-hover3.uc', 0, 9);
      assert.ok(hover, 'Should return hover for %J');
      assert.ok(hover.contents.value.includes('JSON'), `Hover should mention JSON, got: ${hover.contents.value}`);
    });

    it('should show hover for %s specifier', async () => {
      const code = 'printf("%s", "hello");';
      const hover = await getHover(code, '/tmp/printf-hover4.uc', 0, 9);
      assert.ok(hover, 'Should return hover for %s');
      assert.ok(hover.contents.value.includes('string'), `Hover should mention string, got: ${hover.contents.value}`);
    });

    it('should show hover for sprintf format specifiers', async () => {
      const code = 'sprintf("%x", 255);';
      const hover = await getHover(code, '/tmp/printf-hover5.uc', 0, 10);
      assert.ok(hover, 'Should return hover for sprintf %x');
      assert.ok(hover.contents.value.includes('hex'), `Hover should mention hex, got: ${hover.contents.value}`);
    });

    it('should not show format hover for non-printf strings', async () => {
      const code = 'let x = "%d";';
      const hover = await getHover(code, '/tmp/printf-hover6.uc', 0, 10);
      // Should NOT show format specifier hover (may be null or different hover)
      if (hover && hover.contents && hover.contents.value) {
        assert.ok(!hover.contents.value.includes('Format specifier'), 'Should not show format hover for non-printf strings');
      }
    });

    it('should show argument position in hover', async () => {
      const code = 'printf("%s %d", "hi", 42);';
      // Hover over %d (the second specifier)
      // "%s %d" — %s at index 0, %d at index 3
      // In the document: col 8 is %, col 9 is s, col 10 is space, col 11 is %, col 12 is d
      const hover = await getHover(code, '/tmp/printf-hover7.uc', 0, 12);
      assert.ok(hover, 'Should return hover for second specifier');
      assert.ok(hover.contents.value.includes('Argument 2'), `Hover should show argument 2, got: ${hover.contents.value}`);
    });

    it('should show hover for flags like %-10s', async () => {
      const code = 'printf("%-10s", "hi");';
      const hover = await getHover(code, '/tmp/printf-hover8.uc', 0, 10);
      assert.ok(hover, 'Should return hover for %-10s');
      assert.ok(hover.contents.value.includes('Flags'), `Hover should include Flags, got: ${hover.contents.value}`);
      assert.ok(hover.contents.value.includes('left-align'), `Hover should describe left-align flag, got: ${hover.contents.value}`);
    });
  });
});
