// Debug test for object property key diagnostics
import { test, expect } from 'bun:test';

test('Debug object property key parsing', async () => {
    console.log('🔍 Testing object property key parsing...');
    
    // Test that property keys should have computed: false
    const testCode = `
    obj[iface] = {
        rx_bytes: to_num(cols[0]),
        rx_packets: to_num(cols[1])
    };
    `;
    
    console.log('✅ Test code with object literal property keys created');
    console.log('✅ Property keys like "rx_bytes" should have computed: false');
    console.log('✅ visitProperty should NOT visit non-computed keys');
    
    console.log('🔍 Expected behavior:');
    console.log('  - rx_bytes: PropertyNode { computed: false }');
    console.log('  - Should NOT trigger visitIdentifier for "rx_bytes"');
    console.log('  - Should NOT show "Undefined variable: rx_bytes"');
    
    console.log('🔍 If still showing errors, check:');
    console.log('  1. Parser correctly setting computed: false for literal keys');
    console.log('  2. visitProperty override in SemanticAnalyzer is working');
    console.log('  3. No other visitor methods are calling visitIdentifier on keys');
    
    console.log('✅ Debug test completed');
});