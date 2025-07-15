// Debug stray slash issue
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🐛 Testing stray slash after block comment...\n');

const testCode = `/**
 * First comment
 */ /
export function test() {
    /* Second comment */
}`;

console.log('Testing code:');
console.log(testCode);
console.log('\n1. Lexing phase:');

function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) {
            return key;
        }
    }
    return 'UNKNOWN';
}

try {
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('All tokens:');
    tokens.forEach((token, i) => {
        console.log(`  ${i}: ${getTokenName(token.type)} (${JSON.stringify(token.value)}) at ${token.pos}-${token.end}`);
    });
    
} catch (error) {
    console.log('❌ Exception:', error.message);
}