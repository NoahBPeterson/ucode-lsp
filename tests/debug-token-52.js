// Debug what token 52 actually is
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('Looking for token type 52:');
for (const [key, value] of Object.entries(TokenType)) {
    if (value === 52) {
        console.log(`Token type 52 is: ${key}`);
    }
}

// Check specific tokens
console.log('\nSpecific tokens:');
console.log('TK_DEC:', TokenType.TK_DEC);
console.log('TK_EXPORT:', TokenType.TK_EXPORT);
console.log('TK_EOF:', TokenType.TK_EOF);

// Check first few tokens
console.log('\nFirst few tokens:');
for (let i = 50; i <= 55; i++) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === i) {
            console.log(`${i}: ${key}`);
        }
    }
}