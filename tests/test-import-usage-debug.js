// Test to debug import usage tracking
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Import Usage Tracking Debug', function() {
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

  it('should NOT show unused warning when imported function is called', async function() {
    const testContent = `import { cursor } from 'uci';

cursor();`;

    const diagnostics = await getDiagnostics(testContent, 'test.uc');
    console.log('Diagnostics:', JSON.stringify(diagnostics, null, 2));

    const unusedWarnings = diagnostics.filter(d =>
      d.message.includes('never used') && d.message.includes('cursor')
    );

    assert.strictEqual(unusedWarnings.length, 0,
      'cursor should NOT be marked as unused when it is called'
    );
  });

  it('should NOT show unused warning when imported value is used in binary expression', async function() {
    const testContent = `const valid_authentications = ['open', 'psk'];

function test(a) {
  if (a in valid_authentications) {
    return true;
  }
  return false;
}`;

    const diagnostics = await getDiagnostics(testContent, 'test.uc');
    console.log('Diagnostics:', JSON.stringify(diagnostics, null, 2));

    const unusedWarnings = diagnostics.filter(d =>
      d.message.includes('never used') && d.message.includes('valid_authentications')
    );

    assert.strictEqual(unusedWarnings.length, 0,
      'valid_authentications should NOT be marked as unused when it is used in "in" operator'
    );
  });
});
