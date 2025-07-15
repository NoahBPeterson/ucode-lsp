// Debug export tokenization
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

const code = 'export function';
console.log('Testing tokenization of:', code);

const lexer = new UcodeLexer(code);
const tokens = lexer.tokenize();

console.log('Tokens generated:');
tokens.forEach((token, i) => {
  console.log(`${i}: ${token.type} (${token.value}) - token type number: ${token.type}`);
});

console.log('\nExpected:');
console.log('TK_EXPORT =', TokenType.TK_EXPORT);
console.log('TK_FUNC =', TokenType.TK_FUNC);
console.log('TK_LABEL =', TokenType.TK_LABEL);