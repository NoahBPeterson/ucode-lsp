#!/usr/bin/env bun

import { UcodeLexer, TokenType } from '../src/lexer';
import { UcodeParser } from '../src/parser/parser';
import { readFileSync } from 'fs';

// Read the test file
const testCode = readFileSync('./tests/test-mismatched-only.uc', 'utf-8');
console.log('Testing brace issue...\n');
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