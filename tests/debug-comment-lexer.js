// Debug block comment lexing
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');

console.log('🐛 Testing block comment lexing...\n');

const testCode = `/**
 * Block comment
 */
export function test() {}`;

console.log('Testing code:');
console.log(testCode);
console.log('\n1. Lexing phase:');

try {
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('All tokens:');
    tokens.forEach((token, i) => {
        console.log(`  ${i}: ${token.type} (${JSON.stringify(token.value)}) at ${token.pos}-${token.end}`);
    });
    
} catch (error) {
    console.log('❌ Exception:', error.message);
}