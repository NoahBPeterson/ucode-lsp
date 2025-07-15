// Simple debug test
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');

const code = 'export';
console.log('Testing just "export":', code);

const lexer = new UcodeLexer(code);
const tokens = lexer.tokenize();

console.log('Tokens generated:');
tokens.forEach((token, i) => {
  console.log(`${i}: ${token.type} (${token.value})`);
});

// Test with space
const code2 = 'export ';
console.log('\nTesting "export " (with space):', code2);

const lexer2 = new UcodeLexer(code2);
const tokens2 = lexer2.tokenize();

console.log('Tokens generated:');
tokens2.forEach((token, i) => {
  console.log(`${i}: ${token.type} (${token.value})`);
});