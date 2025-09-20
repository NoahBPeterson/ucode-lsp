/**
 * Unit tests for dot notation namespace import completions
 * Tests the specific issue: import * as logss from 'u1905.u1905d.src.u1905.log'; logss.
 */

const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Dot Notation Namespace Import Completions', () => {
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

    it('should provide default completion for dot notation namespace import', async function() {
        this.timeout(5000);
        
        const testContent = `import * as logss from 'tests.u1905.u1905d.src.u1905.log';
logss.`;
        const testFilePath = '/Users/test/test-dot-notation-namespace.uc';
        
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 6);
        const items = completions?.items || completions || [];
        
        console.log(`Dot notation namespace completions: ${items.length} items`);
        items.forEach(item => console.log(`  - ${item.label} (kind: ${item.kind})`));
        
        // Should have 'default' completion so user can access logss.default.propertyName
        const defaultCompletion = items.find(item => item.label === 'default');
        if (!defaultCompletion) {
            throw new Error(`Expected 'default' completion not found. Got: ${items.map(i => i.label).join(', ')}`);
        }
        if (defaultCompletion.kind !== 10) { // CompletionItemKind.Property = 10
            throw new Error(`Expected 'default' to have kind 10 (Property), got ${defaultCompletion.kind}`);
        }
    });

    it('should demonstrate the difference between namespace access patterns', async function() {
        this.timeout(5000);
        
        // Test both patterns with dot notation
        const namespaceAccessContent = `import * as logss from 'tests.u1905.u1905d.src.u1905.log';
logss.`;
        const defaultAccessContent = `import * as logss from 'tests.u1905.u1905d.src.u1905.log';
logss.default.`;
        
        const [namespaceCompletions, defaultCompletions] = await Promise.all([
            lspServer.getCompletions(namespaceAccessContent, './test-namespace.uc', 1, 6),
            lspServer.getCompletions(defaultAccessContent, './test-default.uc', 1, 14)
        ]);
        
        const namespaceItems = (namespaceCompletions?.items || namespaceCompletions || []).map(i => i.label).sort();
        const defaultItems = (defaultCompletions?.items || defaultCompletions || []).map(i => i.label).sort();
        
        console.log(`Namespace access (logss.): ${namespaceItems.join(', ')}`);
        console.log(`Default access (logss.default.): ${defaultItems.join(', ')}`);
        
        // Namespace access should show 'default'
        if (!namespaceItems.includes('default')) {
            throw new Error(`Namespace access should show 'default' completion. Got: ${namespaceItems.join(', ')}`);
        }
        
        // Default access should show the actual methods (debug, warn, error, info)
        const expectedMethods = ['debug', 'warn', 'error', 'info'];
        for (const method of expectedMethods) {
            if (!defaultItems.includes(method)) {
                throw new Error(`Default access should show '${method}' method. Got: ${defaultItems.join(', ')}`);
            }
        }
        
        console.log('✅ Both access patterns work correctly');
    });
});