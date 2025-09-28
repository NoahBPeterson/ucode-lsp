/**
 * Type Inference System Tests
 * 
 * Tests type inference behavior, especially for built-in functions like arrtoip()
 * and hover information accuracy.
 */

import { test, expect } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

// Helper function to extract text from hover contents
const getHoverText = (hoverResult) => {
    if (!hoverResult || !hoverResult.contents) return '';
    if (typeof hoverResult.contents === 'string') return hoverResult.contents;
    if (Array.isArray(hoverResult.contents)) {
        return hoverResult.contents.map(c => typeof c === 'string' ? c : c.value || c).join(' ');
    }
    return hoverResult.contents.value || hoverResult.contents.toString();
};

test('arrtoip() should correctly infer array type before assignment', async () => {
    const server = createLSPTestServer();
    await server.initialize();
    
    try {
        const code = `let netmask = [1,2,3,4];
// Test hover on netmask before assignment`;

        const testFilePath = '/tmp/test-arrtoip-before.uc';
        
        // Get hover info for 'netmask' on line 0, character 4 (inside the variable name)
        const hoverResult = await server.getHover(code, testFilePath, 0, 4);
        
        expect(hoverResult).toBeTruthy();
        expect(hoverResult.contents).toBeTruthy();
        
        // The variable should be inferred as array type
        const contents = getHoverText(hoverResult);
        console.log('🔍 Before arrtoip - hover contents:', contents);
        
        // This should pass when the bug is fixed
        if (contents.toLowerCase().includes('array')) {
            console.log('✅ CORRECT: Array literal correctly inferred as array');
            expect(contents.toLowerCase()).toMatch(/array/);
        } else {
            console.log('❌ BUG: Array literal [1,2,3,4] incorrectly inferred as:', contents);
            // This test should fail until the bug is fixed
            expect(contents.toLowerCase()).toMatch(/array/);
        }
    } finally {
        await server.shutdown();
    }
});

test('arrtoip() should correctly infer string type after assignment', async () => {
    const server = createLSPTestServer();
    await server.initialize();
    
    try {
        const code = `let netmask = [1,2,3,4];
netmask = arrtoip(netmask);
// Test hover on netmask after assignment`;

        const testFilePath = '/tmp/test-arrtoip-after.uc';
        
        // Get hover info for 'netmask' on line 1, character 0 (left side of assignment)
        const hoverResult = await server.getHover(code, testFilePath, 1, 0);
        
        expect(hoverResult).toBeTruthy();
        expect(hoverResult.contents).toBeTruthy();
        
        // After arrtoip() assignment, netmask should be string type
        const contents = getHoverText(hoverResult);
        console.log('🔍 After arrtoip assignment - hover contents:', contents);
        
        // This is the current failing behavior - let's document what we actually get
        // and what we expect
        if (contents.toLowerCase().includes('string')) {
            console.log('✅ CORRECT: netmask shows as string type after arrtoip()');
        } else {
            console.log('❌ INCORRECT: netmask should show as string type after arrtoip(), but shows:', contents);
        }
        
        expect(contents.toLowerCase()).toMatch(/string/);
    } finally {
        await server.shutdown();
    }
});

test('arrtoip() followed by iptoarr() should preserve declaration string hover', async () => {
    const server = createLSPTestServer();
    await server.initialize();

    try {
        const code = `let test = arrtoip([5,4,3,2]);
test = iptoarr(test);`;

        const testFilePath = '/tmp/test-arrtoip-iptoarr-transition.uc';

        const declarationHover = await server.getHover(code, testFilePath, 0, 4);
        const declarationContents = getHoverText(declarationHover);
        console.log('🔍 arrtoip declaration hover:', declarationContents);
        expect(declarationContents.toLowerCase()).toMatch(/string/);

        const reassignmentHover = await server.getHover(code, testFilePath, 1, 0);
        const reassignmentContents = getHoverText(reassignmentHover);
        console.log('🔍 iptoarr reassignment hover:', reassignmentContents);
        expect(reassignmentContents.toLowerCase()).toMatch(/array/);
    } finally {
        await server.shutdown();
    }
});

test('arrtoip() should show array type for right-hand side of assignment', async () => {
    const server = createLSPTestServer();
    await server.initialize();
    
    try {
        const code = `let netmask = [1,2,3,4];
netmask = arrtoip(netmask);`;

        const testFilePath = '/tmp/test-arrtoip-rhs.uc';
        
        // Get hover info for 'netmask' on line 1, character 16 (right side of assignment, inside arrtoip call)
        const hoverResult = await server.getHover(code, testFilePath, 1, 16);
        
        expect(hoverResult).toBeTruthy();
        expect(hoverResult.contents).toBeTruthy();
        
        // The right-hand side netmask should still show as array
        const contents = getHoverText(hoverResult);
        console.log('🔍 Right-hand side of arrtoip() - hover contents:', contents);
        
        if (contents.toLowerCase().includes('array')) {
            console.log('✅ CORRECT: Right-hand side netmask shows as array type');
        } else {
            console.log('❌ INCORRECT: Right-hand side netmask should show as array type, but shows:', contents);
        }
        
        expect(contents.toLowerCase()).toMatch(/array/);
    } finally {
        await server.shutdown();
    }
});

test('arrtoip() should not show type inference errors for valid usage', async () => {
    const server = createLSPTestServer();
    await server.initialize();
    
    try {
        const code = `let netmask = [1,2,3,4];
netmask = arrtoip(netmask);`;

        const testFilePath = '/tmp/test-arrtoip-no-errors.uc';
        
        const diagnostics = await server.getDiagnostics(code, testFilePath);
        
        // Filter for arrtoip-related type errors
        const arrtoipErrors = diagnostics.filter(d => 
            d.message.includes('arrtoip') && 
            (d.message.includes('expects array') || d.message.includes('got string'))
        );
        
        console.log('🔍 arrtoip() diagnostics:', arrtoipErrors.map(d => d.message));
        
        expect(arrtoipErrors).toHaveLength(0);
    } finally {
        await server.shutdown();
    }
});

test('String literal should be inferred as string type', async () => {
    const server = createLSPTestServer();
    await server.initialize();
    
    try {
        const code = `let ip = "192.168.1.1";`;

        const testFilePath = '/tmp/test-string-literal.uc';
        
        // Test string literal inference
        const hoverResult = await server.getHover(code, testFilePath, 0, 4);
        const contents = getHoverText(hoverResult);
        console.log('🔍 String literal hover contents:', contents);
        
        // This test should fail until the literal type inference bug is fixed
        if (contents.toLowerCase().includes('string')) {
            console.log('✅ CORRECT: String literal correctly inferred as string');
        } else {
            console.log('❌ BUG: String literal "192.168.1.1" incorrectly inferred as:', contents);
        }
        
        expect(contents.toLowerCase()).toMatch(/string/);
    } finally {
        await server.shutdown();
    }
});

test('Array literal with assignment on next line', async () => {
    const server = createLSPTestServer();
    await server.initialize();
    
    try {
        // Test without comments first to isolate the issue
        const code = `let netmask = [1,2,3,4];
netmask = arrtoip(netmask);`;

        const testFilePath = '/tmp/test-assignment.uc';
        
        console.log('🧪 Testing array literal followed by assignment...');
        
        // Test initial declaration - should be array
        const initialHover = await server.getHover(code, testFilePath, 0, 4);
        const initialContents = getHoverText(initialHover);
        console.log('🔍 Initial declaration hover:', initialContents);
        
        // This is the key test - the initial declaration should show as array even when followed by assignment
        expect(initialContents.toLowerCase()).toMatch(/array/);
    } finally {
        await server.shutdown();
    }
});
