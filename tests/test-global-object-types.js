const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Global Object Type Propagation', () => {
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

    function extractHoverText(hover) {
        if (!hover || !hover.contents) {
            return '';
        }
        if (typeof hover.contents === 'string') {
            return hover.contents;
        }
        if (Array.isArray(hover.contents)) {
            return hover.contents.map(item => typeof item === 'string' ? item : item.value || '').join('\n');
        }
        return hover.contents.value || '';
    }

    it('should infer types for global string properties', async function() {
        this.timeout(5000);

        const testContent = `global.d = "lol";
let e = global.d;
e.`;
        const testFilePath = path.join(process.cwd(), 'tests/global-string-global.uc');
        const hover = await lspServer.getHover(testContent, testFilePath, 1, 4);
        const hoverText = extractHoverText(hover);

        assert.ok(hover && hoverText.includes('string'), 'Hover for variable assigned from global should report string type');
    });

    it('should propagate complex types from global properties', async function() {
        this.timeout(5000);

        const testContent = `const fs = require('fs');
global.filesystem = fs;
let alias = global.filesystem;
alias.`;
        const testFilePath = path.join(process.cwd(), 'tests/global-fs-global.uc');
        const completions = await lspServer.getCompletions(testContent, testFilePath, 3, 6);
        const items = completions?.items || completions || [];

        assert.ok(items.length > 0, 'fs alias from global should have completions');
        const labels = new Set(items.map(item => item.label));
        assert.ok(labels.has('open'), 'fs completions should include open');
    });
});
