/**
 * Mocha root hook plugin — shared LSP server for all test files.
 *
 * Usage:
 *   mocha --require tests/mocha-shared-setup.js tests/test-*.js
 *
 * When loaded, a single LSP server is started in beforeAll and stored on
 * global.__sharedLSPServer.  createLSPTestServer() in lsp-test-helpers.js
 * detects this global and returns a lightweight wrapper (no-op initialize /
 * shutdown, delegates all methods), so every test file transparently reuses
 * the same server process.
 */

const { createLSPTestServer } = require('./lsp-test-helpers');

module.exports = {
  mochaHooks: {
    async beforeAll() {
      const server = createLSPTestServer({
        capabilities: {
          textDocument: {
            hover: { dynamicRegistration: false },
            completion: {
              completionItem: { snippetSupport: true }
            },
            codeAction: {
              dynamicRegistration: false,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: ['quickfix']
                }
              }
            }
          }
        }
      });
      await server.initialize();
      global.__sharedLSPServer = server;
    },
    async afterAll() {
      if (global.__sharedLSPServer) {
        global.__sharedLSPServer.shutdown();
        global.__sharedLSPServer = null;
      }
    }
  }
};
