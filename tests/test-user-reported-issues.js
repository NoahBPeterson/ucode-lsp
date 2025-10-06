// Test for user-reported issues from the conversation
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('User Reported Issues', function() {
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

  it('Issue 1: import { cursor } from "uci" should NOT show as unused when used in object method', async function() {
    const testContent = `import { cursor } from 'uci';

export default {
  parseBSSConfigurations: function () {
    cursor().foreach('umapd', null, section => {
      // Do something
    });
  }
};`;

    const diagnostics = await getDiagnostics(testContent, 'test.uc');
    const unusedWarnings = diagnostics.filter(d =>
      d.message.includes('never used') && d.message.includes('cursor')
    );

    assert.strictEqual(unusedWarnings.length, 0,
      'cursor should NOT be marked as unused when used in object method'
    );
  });

  it('Issue 3: const valid_authentications used with "in" operator should NOT show as unused', async function() {
    const testContent = `const valid_authentications = ['open', 'psk', 'wpa', 'wpa2', 'psk2', 'sae'];

export default {
  validate: function(authentication) {
    if (length(filter(authentication, a => !(a in valid_authentications)))) {
      return false;
    }
    return true;
  }
};`;

    const diagnostics = await getDiagnostics(testContent, 'test.uc');
    const unusedWarnings = diagnostics.filter(d =>
      d.message.includes('never used') && d.message.includes('valid_authentications')
    );

    assert.strictEqual(unusedWarnings.length, 0,
      'valid_authentications should NOT be marked as unused when used in "in" operator'
    );
  });
});
