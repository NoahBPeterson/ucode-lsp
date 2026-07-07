const assert = require('assert');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Disable Comments Warning Conversion Tests', function() {
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

  // Ticket 08: a `// ucode-lsp disable` comment now REMOVES the covered diagnostics
  // (it used to only demote their severity). These tests assert removal.
  describe('Diagnostic Removal', function() {
    it('should remove diagnostics on disabled lines', async function() {
      const testContent = `let errorVar = undefinedFunction(); // ucode-lsp disable`;
      const testFilePath = `/tmp/test-error-removed-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      // The whole line is disabled — no diagnostics of any severity should remain on line 0.
      const line0 = diagnostics.filter(d => d.range.start.line === 0);
      assert.strictEqual(line0.length, 0,
        `Disabled line should have no diagnostics, got: ${JSON.stringify(line0.map(d => d.message))}`);
    });

    it('should keep diagnostics on non-disabled lines and remove them only on disabled ones', async function() {
      const testContent = `let errorVar1 = undefinedFunction1();
let errorVar2 = undefinedFunction2(); // ucode-lsp disable
let errorVar3 = undefinedFunction3();`;
      const testFilePath = `/tmp/test-mixed-errors-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      const line1 = diagnostics.filter(d => d.range.start.line === 1);
      assert.strictEqual(line1.length, 0, 'Disabled line 1 should have no diagnostics');

      // Lines 0 and 2 keep their error-level diagnostics.
      assert(diagnostics.some(d => d.range.start.line === 0 && d.severity === 1),
        'Line 0 should keep error-level diagnostics');
      assert(diagnostics.some(d => d.range.start.line === 2 && d.severity === 1),
        'Line 2 should keep error-level diagnostics');
    });

    it('should remove unused-variable warnings on disabled lines', async function() {
      const testContent = `let unusedVar = 42; // ucode-lsp disable`;
      const testFilePath = `/tmp/test-warning-removed-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      const unusedVarDiagnostics = diagnostics.filter(d => d.message.includes('never used'));
      assert.strictEqual(unusedVarDiagnostics.length, 0,
        'Unused-variable warning on a disabled line should be removed');
    });

    it('should only suppress the listed rule code (// ucode-lsp disable UC1006)', async function() {
      // errorVar is undefined-var (UC1001) AND unused (UC1006). Only UC1006 is disabled,
      // so UC1001 must survive.
      const testContent = `let x = undefinedThing; // ucode-lsp disable UC1006`;
      const testFilePath = `/tmp/test-code-targeted-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);
      const line0 = diagnostics.filter(d => d.range.start.line === 0);

      assert(line0.some(d => d.code === 'UC1001'),
        `UC1001 (undefined var) must survive a UC1006-only disable, got: ${JSON.stringify(line0.map(d => d.code))}`);
      assert(!line0.some(d => d.code === 'UC1006'),
        'UC1006 (unused) must be removed by the UC1006-targeted disable');
    });
  });

  describe('Unnecessary Disable Comment Warnings', function() {
    it('should warn about a stale code-targeted disable that matches nothing', async function() {
      // `print(...)` is diagnostic-free, so the UC1001-targeted disable suppresses nothing.
      const testContent = `print("hello"); // ucode-lsp disable UC1001`;
      const testFilePath = `/tmp/test-stale-disable-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      const unnecessary = diagnostics.filter(d =>
        d.message.includes('No diagnostic disabled') && d.severity === 2
      );
      assert(unnecessary.length > 0, 'Should warn about a stale code-targeted disable');

      const warning = unnecessary[0];
      const lineText = testContent.split('\n')[warning.range.start.line];
      const warningText = lineText.substring(warning.range.start.character, warning.range.end.character);
      assert(warningText.includes('// ucode-lsp disable'), 'Warning should point to the disable comment');
    });

    it('should NOT warn about a bare defensive disable that matches nothing', async function() {
      // Ticket 08: a bare `// ucode-lsp disable` is legitimate defensive use and must never
      // produce the self-inflicted "No diagnostic disabled" noise.
      const testContent = `print("hello"); // ucode-lsp disable`;
      const testFilePath = `/tmp/test-bare-defensive-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      const unnecessary = diagnostics.filter(d => d.message.includes('No diagnostic disabled'));
      assert.strictEqual(unnecessary.length, 0, 'Bare defensive disable must not be flagged as unnecessary');
    });

    it('should not warn about a disable that suppressed something', async function() {
      const testContent = `let errorVar = undefinedFunction(); // ucode-lsp disable`;
      const testFilePath = `/tmp/test-necessary-disable-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      const unnecessary = diagnostics.filter(d => d.message.includes('No diagnostic disabled'));
      assert.strictEqual(unnecessary.length, 0, 'Should not warn about a necessary disable comment');

      // The suppressed error is removed entirely.
      const line0 = diagnostics.filter(d => d.range.start.line === 0);
      assert.strictEqual(line0.length, 0, 'Disabled line should have no remaining diagnostics');
    });

    it('should handle multiple disable comments correctly', async function() {
      const testContent = `let errorVar = undefinedFunction(); // ucode-lsp disable
print("no issues"); // ucode-lsp disable
let anotherError = anotherUndefinedFunction(); // ucode-lsp disable`;
      const testFilePath = `/tmp/test-multiple-disable-${Date.now()}.uc`;

      const diagnostics = await getDiagnostics(testContent, testFilePath);

      // No line should carry an unnecessary-disable warning: line 1 is a bare defensive
      // disable, lines 0/2 genuinely suppressed errors.
      const unnecessary = diagnostics.filter(d => d.message.includes('No diagnostic disabled'));
      assert.strictEqual(unnecessary.length, 0, 'Bare disables should never be flagged as unnecessary');

      // Lines 0 and 2 had their errors removed entirely.
      assert.strictEqual(diagnostics.filter(d => d.range.start.line === 0).length, 0, 'Line 0 diagnostics removed');
      assert.strictEqual(diagnostics.filter(d => d.range.start.line === 2).length, 0, 'Line 2 diagnostics removed');
    });
  });
});
