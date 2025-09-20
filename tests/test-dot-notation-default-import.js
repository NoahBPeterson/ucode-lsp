const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Dot Notation Default Import Completions', () => {
    let lspServer;

    beforeEach(async function() {
        this.timeout(10000);
        lspServer = createLSPTestServer();
        await lspServer.initialize();
    });

    afterEach(async () => {
        if (lspServer) {
            await lspServer.shutdown();
        }
    });

    it('should provide completions for dot notation default imports', async function() {
        this.timeout(5000);

        const testContent = `import defs from 'umap.defs';
defs.`;
        const testFilePath = path.join(process.cwd(), 'umapd/umapd/src/test-dot-notation-default.uc');
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 5);

        const items = completions?.items || completions || [];
        assert.ok(items.length > 0, 'Dot notation default import should provide completions');

        const labels = new Set(items.map(item => item.label));
        assert.ok(labels.has('MSG_AP_AUTOCONFIGURATION_SEARCH'), 'Should include MSG_AP_AUTOCONFIGURATION_SEARCH');
        assert.ok(labels.has('IEEE1905_MULTICAST_MAC'), 'Should include IEEE1905_MULTICAST_MAC');
    });

    it('should propagate default import completions through aliases', async function() {
        this.timeout(5000);

        const testContent = `import defs from 'umap.defs';
const defsAlias = defs;
defsAlias.`;
        const testFilePath = path.join(process.cwd(), 'umapd/umapd/src/test-dot-notation-alias.uc');
        const completions = await lspServer.getCompletions(testContent, testFilePath, 2, 9);

        const items = completions?.items || completions || [];
        assert.ok(items.length > 0, 'Alias of default import should provide completions');

        const labels = new Set(items.map(item => item.label));
        assert.ok(labels.has('MSG_AP_AUTOCONFIGURATION_SEARCH'), 'Alias should include MSG_AP_AUTOCONFIGURATION_SEARCH');
    });
});
