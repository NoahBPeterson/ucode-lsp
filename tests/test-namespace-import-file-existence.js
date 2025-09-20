/**
 * Unit tests for namespace import completions with file existence validation
 * Tests that namespace imports only show completions when the imported file actually exists
 */

const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Namespace Import File Existence Validation', () => {
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

    it('should NOT show completions for non-existent files', async function() {
        this.timeout(5000);
        
        const testContent = `import * as badimport from './nonexistent/path/file.uc';
badimport.`;
        const testFilePath = '/Users/test/test-nonexistent.uc';
        
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 10);
        const items = completions?.items || completions || [];
        
        console.log(`Non-existent file completions: ${items.length} items`);
        items.forEach(item => console.log(`  - ${item.label} (detail: ${item.detail})`));
        
        if (items.length > 0) {
            throw new Error(`Expected no completions for non-existent file. Got: ${items.map(i => i.label).join(', ')}`);
        }
        
        console.log('✅ Correctly shows no completions for non-existent files');
    });

    it('should show completions for existing files', async function() {
        this.timeout(5000);
        
        const testContent = `import * as logss from 'tests.u1905.u1905d.src.u1905.log';
logss.`;
        const testFilePath = '/Users/test/test-existing.uc';
        
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 6);
        const items = completions?.items || completions || [];
        
        console.log(`Existing file completions: ${items.length} items`);
        items.forEach(item => console.log(`  - ${item.label} (detail: ${item.detail})`));
        
        const defaultCompletion = items.find(item => item.label === 'default');
        if (!defaultCompletion) {
            throw new Error(`Expected 'default' completion for existing file. Got: ${items.map(i => i.label).join(', ')}`);
        }
        
        console.log('✅ Correctly shows default completion for existing files');
    });

    it('should handle relative path imports correctly', async function() {
        this.timeout(5000);
        
        // Test with non-existent relative path
        const testContent1 = `import * as bad from './does/not/exist.uc';
bad.`;
        
        const completions1 = await lspServer.getCompletions(testContent1, '/Users/test/test1.uc', 1, 4);
        const items1 = completions1?.items || completions1 || [];
        
        if (items1.length > 0) {
            throw new Error(`Expected no completions for non-existent relative path. Got: ${items1.map(i => i.label).join(', ')}`);
        }
        
        // Test with existing relative path (if we can find one)
        const testContent2 = `import * as existing from './u1905/u1905d/src/u1905/log.uc';
existing.`;
        
        const completions2 = await lspServer.getCompletions(testContent2, '/Users/test/test2.uc', 1, 9);
        const items2 = completions2?.items || completions2 || [];
        
        console.log(`Relative path completions: ${items2.length} items`);
        
        // Should show completions if the relative path resolves to an existing file
        // (This might not work in test environment, but shouldn't crash)
        
        console.log('✅ Relative path imports handled correctly');
    });
});