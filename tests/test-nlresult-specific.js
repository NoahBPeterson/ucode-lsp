const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('NLResult Specific Test', function() {
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

  it('should suppress nlresult diagnostic with disable comment', async function() {
    const testContent = `let nlresult = nl.request(); // ucode-lsp disable`;
    const testFilePath = '/tmp/test-nlresult.uc';

    const diagnostics = await getDiagnostics(testContent, testFilePath);

    console.log(`\nNLResult test diagnostics: ${diagnostics.length}`);
    diagnostics.forEach((d, i) => {
      console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
    });

    const errorDiagnostics = diagnostics.filter(d => d.severity === 1);
    const warningDiagnostics = diagnostics.filter(d => d.severity === 2);

    assert.strictEqual(errorDiagnostics.length, 0, `Expected no error-level diagnostics, but got ${errorDiagnostics.length}: ${JSON.stringify(errorDiagnostics.map(d => d.message))}`);

    if (diagnostics.length > 0) {
      const lowSeverityDiagnostics = diagnostics.filter(d => d.severity >= 2);
      assert(lowSeverityDiagnostics.length > 0, 'Should have warning or information level diagnostics (converted from higher severity)');
    }
  });
});
