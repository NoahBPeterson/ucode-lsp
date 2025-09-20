const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Module Alias Completions', () => {
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

    it('should provide completions for namespace import aliases', async function() {
        this.timeout(5000);

        const testContent = `import * as fs from 'fs';
let alias = fs;
alias.`;
        const completions = await lspServer.getCompletions(testContent, '/Users/test/module-alias.uc', 2, 6);
        const items = completions?.items || completions || [];

        assert.ok(items.length > 0, 'Alias should provide completions');
        const labels = items.map(item => item.label);
        assert.ok(labels.includes('readfile'), 'Alias completions should include fs.readfile');
        assert.ok(labels.includes('open'), 'Alias completions should include fs.open');
    });

    it('should propagate completions through chained aliases', async function() {
        this.timeout(5000);

        const testContent = `const fsModule = require('fs');
const alias1 = fsModule;
const alias2 = alias1;
alias2.`;
        const completions = await lspServer.getCompletions(testContent, '/Users/test/module-alias-chain.uc', 3, 7);
        const items = completions?.items || completions || [];

        assert.ok(items.length > 0, 'Chained alias should provide completions');
        const labels = items.map(item => item.label);
        assert.ok(labels.includes('readfile'), 'Chained alias should include fs.readfile');
        assert.ok(labels.includes('open'), 'Chained alias should include fs.open');
    });
});
