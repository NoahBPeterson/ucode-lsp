// Debug trace for object property diagnostics
console.log('🔍 Debugging object property key diagnostics...');

const testCode = `
let obj = {};
let iface = "eth0"; 
let cols = [100, 200, 300];

function to_num(val) {
    return parseInt(val);
}

// The issue: these property keys are showing "Undefined variable" errors
obj[iface] = {
    rx_bytes:      to_num(cols[0]),
    rx_packets:    to_num(cols[1]),
    rx_err:        to_num(cols[2]),
    tx_bytes:      to_num(cols[8]),
    tx_packets:    to_num(cols[9])
};
`;

console.log('🧪 Test code structure:');
console.log('✅ obj[iface] = { ... } → assignment with object literal');
console.log('✅ rx_bytes: to_num(cols[0]) → property with identifier key');
console.log('✅ Should parse as PropertyNode { computed: false }');

console.log('🔍 Expected visitor flow:');
console.log('1. visitAssignmentExpression → visits obj[iface] and object literal');
console.log('2. visitObjectExpression → visits all properties');
console.log('3. visitProperty → should skip non-computed keys');
console.log('4. visitCallExpression → visits to_num(cols[0])');

console.log('🔧 Potential issues:');
console.log('1. Method override not working - base visitor still called');
console.log('2. Another code path visiting property keys');
console.log('3. Parser setting computed: true instead of false');
console.log('4. Language server using old compiled code');

console.log('✅ Debug trace completed. Check VS Code extension console for actual diagnostics.');