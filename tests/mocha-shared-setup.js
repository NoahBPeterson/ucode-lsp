/**
 * Mocha root hook plugin — shared LSP server for all test files.
 *
 * Usage:
 *   mocha --require tests/mocha-shared-setup.js tests/test-*.js
 *
 * The sharing itself now lives in lsp-test-helpers.js: any createLSPTestServer()
 * call with no bespoke options (workspaceRoot/capabilities/configuration) lazily
 * creates ONE real server on global.__sharedLSPServer and returns a delegating
 * wrapper (no-op shutdown; initialize() awaits the one-time handshake). This
 * hook just warms the server up-front so the first suite doesn't pay the
 * handshake inside its own before(), and tears it down at the very end.
 */

const { createLSPTestServer } = require('./lsp-test-helpers');

module.exports = {
  mochaHooks: {
    async beforeAll() {
      await createLSPTestServer().initialize();
    },
    async afterAll() {
      if (global.__sharedLSPServer) {
        global.__sharedLSPServer.shutdown();
        global.__sharedLSPServer = null;
        global.__sharedLSPServerInit = null;
      }
    }
  }
};
