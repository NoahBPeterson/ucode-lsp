#!/usr/bin/env bun

import { UcodeLexer } from '../src/lexer';
import { UcodeParser } from '../src/parser/parser';
import { readFileSync } from 'fs';

// Read the test file
const testCode = readFileSync('./tests/test-syntax-errors.uc', 'utf-8');
console.log('Testing syntax errors...\n');

// Create lexer and tokenize
const lexer = new UcodeLexer(testCode);
const tokens = lexer.tokenize();

console.log('Tokens generated:', tokens.length);

// Parse
const parser = new UcodeParser(tokens, testCode);
const result = parser.parse();

console.log('\nParsing results:');
console.log('- Errors found:', result.errors.length);
console.log('- Warnings found:', result.warnings.length);

if (result.errors.length > 0) {
  console.log('\nErrors:');
  result.errors.forEach((error, i) => {
    console.log(`  ${i + 1}. ${error.message} at line ${error.line}, column ${error.column}`);
  });
} else {
  console.log('\nNo errors detected - this is unexpected!');
}

if (result.warnings.length > 0) {
  console.log('\nWarnings:');
  result.warnings.forEach((warning, i) => {
    console.log(`  ${i + 1}. ${warning.message} at line ${warning.line}, column ${warning.column}`);
  });
}