// Debug with rawMode enabled
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

const code = 'export function generate_bandwidth_overrides() {';
console.log('Testing with rawMode enabled:', code);

const lexer = new UcodeLexer(code, { rawMode: true });
const tokens = lexer.tokenize();

console.log('Tokens generated:');
tokens.forEach((token, i) => {
  console.log(`${i}: ${token.type} (${token.value}) - expected: ${getTokenName(token.type)}`);
});

function getTokenName(type) {
  for (const [key, value] of Object.entries(TokenType)) {
    if (value === type) {
      return key;
    }
  }
  return 'UNKNOWN';
}

console.log('\nExpected tokens:');
console.log('TK_EXPORT =', TokenType.TK_EXPORT);
console.log('TK_FUNC =', TokenType.TK_FUNC);
console.log('TK_LABEL =', TokenType.TK_LABEL);