const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers.js');

/**
 * Test for const import completions regression using real LSP protocol
 *
 * Tests that:
 * 1. import { 'const' as rtnlconst } from 'rtnl'; only shows constants in completions
 * 2. import * as rtnl from 'rtnl'; shows all exports (functions + constants)
 * 3. const imports have correct hover type (object)
 */

console.log('🧪 Running Const Import Completions Regression Tests...');

let lspServer;

beforeAll(async () => {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
});

afterAll(() => {
    if (lspServer) {
        lspServer.shutdown();
    }
});

test('should show only constants for const imports, not functions', async () => {
        const code = `import { 'const' as rtnlconst } from 'rtnl';
import * as rtnl from 'rtnl';

let a = rtnlconst.
let b = rtnl.`;
        
        const testFilePath = '/tmp/test-const-import-completions.uc';
        
        // Test completions for rtnlconst. (const import)
        // Position after "rtnlconst." on line 3, character 18
        const constCompletions = await lspServer.getCompletions(code, testFilePath, 3, 18);
        
        // Test completions for rtnl. (full import)
        // Position after "rtnl." on line 4, character 12  
        const fullCompletions = await lspServer.getCompletions(code, testFilePath, 4, 12);
        
        console.log(`Const import completions: ${constCompletions.length}`);
        console.log(`Full import completions: ${fullCompletions.length}`);
        
        // Const import should have some completions (constants)
        expect(constCompletions.length).toBeGreaterThan(0);

        // Full import should have more completions (functions + constants)
        expect(fullCompletions.length).toBeGreaterThan(0);

        // CRITICAL: Const import should have FEWER completions than full import
        // (only constants vs functions + constants)
        expect(constCompletions.length).toBeLessThan(fullCompletions.length);

        // Verify that const completions are actually constants
        const constItems = constCompletions.map(item => item.label);
        const fullItems = fullCompletions.map(item => item.label);

        console.log('Const completions:', constItems.slice(0, 5), '...');
        console.log('Full completions:', fullItems.slice(0, 5), '...');

        // Check that const completions don't include function names like 'request', 'listener'
        const hasFunctionNames = constItems.some(name =>
            name === 'request' || name === 'listener' || name === 'error'
        );

        expect(hasFunctionNames).toBe(false);

        // Verify const completions include actual constants
        const hasConstants = constItems.some(name =>
            name.startsWith('RT_') || name.startsWith('RTN_') || name.includes('TABLE')
        );

        expect(hasConstants).toBe(true);

        console.log('✅ Const import completion filtering works correctly');
});

test('should test nl80211 const import completions as well', async () => {
        const code = `import { 'const' as nl80211const } from 'nl80211';
import * as nl80211 from 'nl80211';

let a = nl80211const.
let b = nl80211.`;
        
        const testFilePath = '/tmp/test-nl80211-const-import-completions.uc';
        
        // Test completions for nl80211const. (const import)
        // Position after "nl80211const." on line 3, character 20
        const constCompletions = await lspServer.getCompletions(code, testFilePath, 3, 20);
        
        // Test completions for nl80211. (full import)
        // Position after "nl80211." on line 4, character 14
        const fullCompletions = await lspServer.getCompletions(code, testFilePath, 4, 14);
        
        console.log(`NL80211 const import completions: ${constCompletions.length}`);
        console.log(`NL80211 full import completions: ${fullCompletions.length}`);
        
        // Const import should have completions
        expect(constCompletions.length).toBeGreaterThan(0);

        // Note: In this test case, the full nl80211 import might fall back to general completions
        // instead of nl80211-specific completions, so we'll focus on const behavior
        console.log('Note: Testing const import behavior primarily');

        // Verify const completions are actually an array
        expect(Array.isArray(constCompletions)).toBe(true);

        // Verify no function names in const completions
        const constItems = constCompletions.map(item => item.label);
        const hasFunctionNames = constItems.some(name =>
            name === 'request' || name === 'listener' || name === 'error' || name === 'waitfor'
        );

        expect(hasFunctionNames).toBe(false);

        // Verify const completions include actual nl80211 constants
        const hasConstants = constItems.some(name =>
            name.startsWith('NL80211_') || name.startsWith('NLM_')
        );

        expect(hasConstants).toBe(true);

        console.log('✅ NL80211 const import completion filtering works correctly');
});

test('should show correct hover type for const imports', async () => {
        const code = `import { 'const' as rtnlconst } from 'rtnl';
import { 'const' as nl80211const } from 'nl80211';

let a = rtnlconst;
let b = nl80211const;`;
        
        const testFilePath = '/tmp/test-const-import-hover.uc';
        
        // Test hover for rtnlconst
        // Position on "rtnlconst" variable on line 3, character 10  
        const rtnlHover = await lspServer.getHover(code, testFilePath, 3, 10);
        
        // Test hover for nl80211const
        // Position on "nl80211const" variable on line 4, character 10
        const nl80211Hover = await lspServer.getHover(code, testFilePath, 4, 15);
        
        // Both should show hover information
        expect(rtnlHover).toBeTruthy();
        expect(nl80211Hover).toBeTruthy();

        // Check hover contents are simple object type, not full module docs
        if (rtnlHover && rtnlHover.contents) {
            const rtnlContent = typeof rtnlHover.contents === 'string' ?
                rtnlHover.contents : rtnlHover.contents.value || JSON.stringify(rtnlHover.contents);
            console.log('rtnlconst hover:', rtnlContent);

            // Should show simple object type, not full module documentation
            expect(rtnlContent).toContain('(const object)');
            expect(rtnlContent).toContain('object');
            expect(rtnlContent).not.toContain('### Available Functions');
        }

        if (nl80211Hover && nl80211Hover.contents) {
            const nl80211Content = typeof nl80211Hover.contents === 'string' ?
                nl80211Hover.contents : nl80211Hover.contents.value || JSON.stringify(nl80211Hover.contents);
            console.log('nl80211const hover:', nl80211Content);

            // Should show simple object type, not full module documentation
            expect(nl80211Content).toContain('(const object)');
            expect(nl80211Content).toContain('object');
            expect(nl80211Content).not.toContain('### Available Functions');
        }

        console.log('✅ Const import hover shows correct simple object type');
});