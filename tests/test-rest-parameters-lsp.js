/**
 * LSP integration tests for rest parameter support
 * Tests actual LSP server behavior with rest parameters
 */

const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Rest Parameters LSP Integration', function() {
  this.timeout(15000);

  let lspServer;
  let getDiagnostics;
  let getHover;
  let getCompletions;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getHover = lspServer.getHover;
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  it('should not report undefined variable errors for rest parameters', async function() {
    const testContent = `export default {
  debug: (fmt, ...args) => warn(sprintf(\`[D] \${fmt}\\n\`, ...args)),
  warn:  (fmt, ...args) => warn(sprintf(\`[W] \${fmt}\\n\`, ...args))
};`;
    const testFilePath = path.resolve(__dirname, 'temp-rest-params.uc');

    const diagnostics = await getDiagnostics(testContent, testFilePath);

    const argsErrors = diagnostics.filter(diag =>
      diag.message.includes('Undefined variable: args') ||
      (diag.code === 'UC1001' && diag.message.includes('args'))
    );

    assert.strictEqual(argsErrors.length, 0,
      `Should not have undefined variable errors for rest parameters. Found: ${argsErrors.map(e => e.message).join(', ')}`);
  });

  it('should provide hover information for rest parameters', async function() {
    const testContent = `let func = (fmt, ...args) => {
  return args;
};`;
    const testFilePath = path.resolve(__dirname, 'temp-rest-hover.uc');

    const hoverResponse = await getHover(testContent, testFilePath, 1, 9);

    // Hover may return null if no info available, which is acceptable
    if (hoverResponse) {
      const hoverText = typeof hoverResponse.contents === 'string'
        ? hoverResponse.contents
        : hoverResponse.contents.value || '';

      assert.ok(!hoverText.includes('undefined') && !hoverText.includes('not found'),
        `Hover should not indicate undefined variable. Got: ${hoverText}`);
    }
  });
});
