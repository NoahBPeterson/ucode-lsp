// Debug what token 81 is
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('Looking for token type 81:');
for (const [key, value] of Object.entries(TokenType)) {
    if (value === 81) {
        console.log(`Token type 81 is: ${key}`);
    }
}

console.log('TK_COMMENT:', TokenType.TK_COMMENT);