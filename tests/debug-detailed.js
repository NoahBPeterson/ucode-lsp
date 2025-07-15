// Debug lexer in detail
const { Keywords, TokenType, isKeyword } = require('../src/lexer/tokenTypes.ts');

console.log('Testing keyword recognition:');
console.log('Value: "export"');
console.log('isKeyword("export"):', isKeyword("export"));
console.log('Keywords["export"]:', Keywords["export"]);
console.log('TokenType.TK_EXPORT:', TokenType.TK_EXPORT);

// Check if the keyword exists
console.log('\nAll keywords with "export":');
for (const [key, value] of Object.entries(Keywords)) {
    if (key.includes('export')) {
        console.log(`  ${key}: ${value}`);
    }
}

// Manual check
console.log('\nDirect check:');
console.log('Keywords object keys:', Object.keys(Keywords).filter(k => k.includes('exp')));
console.log('Object.hasOwnProperty("export"):', Object.prototype.hasOwnProperty.call(Keywords, 'export'));