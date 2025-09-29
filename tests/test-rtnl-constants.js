const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

/**
 * RTNL Constants Integration Tests
 */
describe('RTNL Constants Integration Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

  let lspServer;
  let getDiagnostics, getCompletions;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  describe('RTNL Constants Import and Usage', function() {
    it('should allow "const" import from rtnl module', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-const-import.uc');
      const importErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes('is not exported by the rtnl module'));
      assert.strictEqual(importErrors.length, 0, 'Should allow "const" import from rtnl module');
    });

    it('should provide member expression completions for rtnl constants', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet value = rtnlconst.`;
      const completions = await getCompletions(testContent, '/tmp/test-rtnl-member.uc', 1, 23);
      const constantCompletions = completions.items || completions || [];
      const rtnConstants = constantCompletions.filter(item => item.label && (
        item.label.startsWith('RT_TABLE_') ||
        item.label.startsWith('RTN_') ||
        item.label.startsWith('RTM_') ||
        item.label.startsWith('NLM_F_')
      ));
      assert(rtnConstants.length > 0, `Should provide rtnl constant completions, got: ${constantCompletions.map(c => c.label).join(', ')}`);
      const labels = constantCompletions.map(c => c.label);
      assert(labels.includes('RT_TABLE_MAIN'), 'Should include RT_TABLE_MAIN constant');
      assert(labels.includes('RTN_UNICAST'), 'Should include RTN_UNICAST constant');
      assert(labels.includes('RTM_GETROUTE'), 'Should include RTM_GETROUTE constant');
    });

    it('should not leak constants to global scope', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet R\n`;
      const completions = await getCompletions(testContent, '/tmp/test-rtnl-noleaks.uc', 1, 5);
      const constantCompletions = completions.items || completions || [];
      const globalRtnConstants = constantCompletions.filter(item => item.label && (
        item.label.startsWith('RTN_') ||
        item.label.startsWith('RT_TABLE_') ||
        item.label.startsWith('RTM_')
      ));
      assert.strictEqual(globalRtnConstants.length, 0, `RTNL constants should not leak to global scope, found: ${globalRtnConstants.map(c => c.label).join(', ')}`);
    });

    it('should allow access to specific rtnl constants via member expression', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet tableMain = rtnlconst.RT_TABLE_MAIN;\nlet routeUnicast = rtnlconst.RTN_UNICAST;\nlet getRoute = rtnlconst.RTM_GETROUTE;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-access.uc');
      const propertyErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes('Property') && d.message.includes('does not exist'));
      assert.strictEqual(propertyErrors.length, 0, `Should allow access to rtnl constants, but got errors: ${propertyErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for invalid rtnl constant access', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet invalid = rtnlconst.INVALID_CONSTANT;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-invalid.uc');
      const propertyErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes("Property 'INVALID_CONSTANT' does not exist"));
      assert(propertyErrors.length > 0, 'Should show error for invalid constant access');
    });
  });

  describe('NL80211 Constants Comparison', function() {
    it('should allow assigning new nl80211 constants without errors', async function() {
      const testContent = `import { request as wlrequest, listener as wllistener, 'const' as wlconst, error as wlerror } from 'nl80211';\nwlconst.NL80211_CMD_ABORT_SCAN ??= wlconst.NL80211_CMD_TDLS_CANCEL_CHANNEL_SWITCH + 2;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-nl80211-const-assignment.uc');
      const propertyErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes("Property 'NL80211_CMD_ABORT_SCAN' does not exist"));
      assert.strictEqual(propertyErrors.length, 0, `Should not flag assignments creating new constants, but got errors: ${propertyErrors.map(e => e.message).join(', ')}`);
    });

    it('should work the same way as nl80211 constants', async function() {
      const testContent = `import { 'const' as nl80211const } from 'nl80211';\nimport { 'const' as rtnlconst } from 'rtnl';\nlet nlCmd = nl80211const.NL80211_CMD_GET_INTERFACE;\nlet rtRoute = rtnlconst.RTN_UNICAST;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-both-constants.uc');
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, `Both nl80211 and rtnl constants should work, but got errors: ${errors.map(e => e.message).join(', ')}`);
    });

    it('should provide completions for both nl80211 and rtnl constants separately', async function() {
      const testContent = `import { 'const' as nl80211const } from 'nl80211';\nimport { 'const' as rtnlconst } from 'rtnl';\nlet nl = nl80211const.`;
      const nlCompletions = await getCompletions(testContent, '/tmp/test-nl-completions.uc', 2, 23);
      const nlItems = nlCompletions.items || nlCompletions || [];
      const nlConstants = nlItems.filter(item => item.label && item.label.startsWith('NL80211_'));
      const rtnlConstants = nlItems.filter(item => item.label && (item.label.startsWith('RTN_') || item.label.startsWith('RTM_')));
      assert(nlConstants.length > 0, 'Should provide nl80211 constants');
      assert.strictEqual(rtnlConstants.length, 0, 'Should not mix in rtnl constants');
    });
  });
});
