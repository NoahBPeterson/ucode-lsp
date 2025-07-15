#!/usr/bin/env bun

import { UcodeLexer, TokenType } from '../src/lexer';
import { UcodeParser } from '../src/parser/parser';
import { readFileSync } from 'fs';

// Read the test file
const testCode = readFileSync('./tests/test-specific-errors.uc', 'utf-8');
console.log('Testing specific error cases...\n');
console.log('Test code:');
console.log(testCode);
console.log('\n' + '='.repeat(50) + '\n');

// Create lexer and tokenize
const lexer = new UcodeLexer(testCode);
const tokens = lexer.tokenize();

console.log('Tokens:');
tokens.forEach((token, i) => {
  const tokenTypeName = Object.keys(TokenType).find(key => TokenType[key as keyof typeof TokenType] === token.type);
  console.log(`${i}: ${token.type} (${tokenTypeName}) "${token.value}" (${token.pos}-${token.end})`);
});

// Check if we have error tokens
console.log('\nTokenType.TK_ERROR value:', TokenType.TK_ERROR);
console.log('Token 4 type value:', tokens[4]?.type);
console.log('Are they equal?', tokens[4]?.type === TokenType.TK_ERROR);

const errorTokens = tokens.filter(t => t.type === TokenType.TK_ERROR);
console.log('\nError tokens found:', errorTokens.length);
errorTokens.forEach((token, i) => {
  console.log(`  Error token ${i}: "${token.value}" at pos ${token.pos}-${token.end}`);
});

// Parse
const parser = new UcodeParser(tokens, testCode);
const result = parser.parse();

console.log('\nParsing results:');
console.log('- Errors found:', result.errors.length);

if (result.errors.length > 0) {
  console.log('\nErrors:');
  result.errors.forEach((error, i) => {
    console.log(`  ${i + 1}. ${error.message} at line ${error.line}, column ${error.column}`);
  });
}