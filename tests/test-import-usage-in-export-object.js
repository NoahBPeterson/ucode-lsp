// Test import usage in exported object methods
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Import Usage in Exported Object Methods', function() {
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

  it('should NOT show unused warning when imported function is used in exported object method', async function() {
    const testContent = `import { cursor } from 'uci';

export default {
  parseBSSConfigurations: function () {
    cursor().foreach('umapd', null, section => {
      // ...
    });
  }
};`;

    const diagnostics = await getDiagnostics(testContent, 'test.uc');
    console.log('Diagnostics:', JSON.stringify(diagnostics, null, 2));

    const unusedWarnings = diagnostics.filter(d =>
      d.message.includes('never used') && d.message.includes('cursor')
    );

    assert.strictEqual(unusedWarnings.length, 0,
      'cursor should NOT be marked as unused when it is used in exported object method'
    );
  });

  it('should NOT show unused warning for variables used with "in" operator in object method', async function() {
    const testContent = `const valid_authentications = ['open', 'psk'];

export default {
  validate: function (a) {
    if (a in valid_authentications) {
      return true;
    }
    return false;
  }
};`;

    const diagnostics = await getDiagnostics(testContent, 'test.uc');
    console.log('Diagnostics:', JSON.stringify(diagnostics, null, 2));

    const unusedWarnings = diagnostics.filter(d =>
      d.message.includes('never used') && d.message.includes('valid_authentications')
    );

    assert.strictEqual(unusedWarnings.length, 0,
      'valid_authentications should NOT be marked as unused when used in object method'
    );
  });
});
