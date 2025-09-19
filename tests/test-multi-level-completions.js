/**
 * Multi-level Object Property Completion Tests
 * 
 * Tests both default import and namespace import completions for nested properties
 */

const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Multi-level Object Property Completions', () => {
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

    it('should provide completions for default import properties', async function() {
        this.timeout(5000);
        
        const testContent = `import logs from './u1905/u1905d/src/u1905/log.uc';
logs.`;
        const testFilePath = './test-default-import.uc';
        
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 5);
        const items = completions?.items || completions || [];
        
        console.log(`Default import completions: ${items.length} items`);
        items.forEach(item => console.log(`  - ${item.label} (kind: ${item.kind})`));
        
        // Should have the 4 log methods
        const expectedMethods = ['debug', 'warn', 'error', 'info'];
        const actualMethods = items.map(item => item.label).sort();
        
        expectedMethods.forEach(method => {
            const found = items.find(item => item.label === method);
            if (!found) {
                throw new Error(`Expected method '${method}' not found in completions: ${actualMethods.join(', ')}`);
            }
            if (found.kind !== 2) { // CompletionItemKind.Method = 2
                throw new Error(`Expected method '${method}' to have kind 2 (Method), got ${found.kind}`);
            }
        });
    });

    it('should provide completions for namespace import default properties', async function() {
        this.timeout(5000);
        
        const testContent = `import * as logss from './u1905/u1905d/src/u1905/log.uc';
logss.default.`;
        const testFilePath = './test-namespace-default.uc';
        
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 14);
        const items = completions?.items || completions || [];
        
        console.log(`Namespace default completions: ${items.length} items`);
        items.forEach(item => console.log(`  - ${item.label} (kind: ${item.kind})`));
        
        // Should have the same 4 log methods as default import
        const expectedMethods = ['debug', 'warn', 'error', 'info'];
        const actualMethods = items.map(item => item.label).sort();
        
        if (items.length === 0) {
            throw new Error('No completions returned for logss.default. - this is the reported bug!');
        }
        
        expectedMethods.forEach(method => {
            const found = items.find(item => item.label === method);
            if (!found) {
                throw new Error(`Expected method '${method}' not found in completions: ${actualMethods.join(', ')}`);
            }
            if (found.kind !== 2) { // CompletionItemKind.Method = 2
                throw new Error(`Expected method '${method}' to have kind 2 (Method), got ${found.kind}`);
            }
        });
    });

    it('should provide namespace completions for simple namespace access', async function() {
        this.timeout(5000);
        
        const testContent = `import * as logss from './u1905/u1905d/src/u1905/log.uc';
logss.`;
        const testFilePath = './test-namespace-simple.uc';
        
        const completions = await lspServer.getCompletions(testContent, testFilePath, 1, 6);
        const items = completions?.items || completions || [];
        
        console.log(`Simple namespace completions: ${items.length} items`);
        items.forEach(item => console.log(`  - ${item.label} (kind: ${item.kind})`));
        
        // Should have 'default' completion
        const defaultCompletion = items.find(item => item.label === 'default');
        if (!defaultCompletion) {
            throw new Error(`Expected 'default' completion not found. Got: ${items.map(i => i.label).join(', ')}`);
        }
        if (defaultCompletion.kind !== 10) { // CompletionItemKind.Property = 10
            throw new Error(`Expected 'default' to have kind 10 (Property), got ${defaultCompletion.kind}`);
        }
    });

    it('should demonstrate the completion equivalence', async function() {
        this.timeout(5000);
        
        // Test both patterns
        const defaultImportContent = `import logs from './u1905/u1905d/src/u1905/log.uc';
logs.`;
        const namespaceImportContent = `import * as logss from './u1905/u1905d/src/u1905/log.uc';
logss.default.`;
        
        const [defaultCompletions, namespaceCompletions] = await Promise.all([
            lspServer.getCompletions(defaultImportContent, './test-default.uc', 1, 5),
            lspServer.getCompletions(namespaceImportContent, './test-namespace.uc', 1, 14)
        ]);
        
        const defaultItems = (defaultCompletions?.items || defaultCompletions || []).map(i => i.label).sort();
        const namespaceItems = (namespaceCompletions?.items || namespaceCompletions || []).map(i => i.label).sort();
        
        console.log(`Default import (logs.): ${defaultItems.join(', ')}`);
        console.log(`Namespace import (logss.default.): ${namespaceItems.join(', ')}`);
        
        // Both should return the same completions
        if (defaultItems.length !== namespaceItems.length) {
            throw new Error(`Different completion counts: default=${defaultItems.length}, namespace=${namespaceItems.length}`);
        }
        
        for (let i = 0; i < defaultItems.length; i++) {
            if (defaultItems[i] !== namespaceItems[i]) {
                throw new Error(`Different completions at index ${i}: default="${defaultItems[i]}", namespace="${namespaceItems[i]}"`);
            }
        }
        
        console.log('✅ Both import patterns return identical completions');
    });
});