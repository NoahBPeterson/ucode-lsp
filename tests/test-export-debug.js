#!/usr/bin/env node

// Debug export statement parsing
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../src/parser/ucodeParser.ts');

console.log('🐛 Debugging Export Statement Parsing...\n');

const testCode = 'export function generate_bandwidth_overrides() {';
console.log('Testing code:', testCode);

try {
    console.log('\n1. Lexing phase:');
    const lexer = new UcodeLexer(testCode);
    const tokens = lexer.tokenize();
    
    console.log('Tokens generated:');
    tokens.forEach((token, i) => {
        console.log(`  ${i}: ${token.type} (${token.value}) at ${token.pos}-${token.end}`);
    });
    
    console.log('\n2. Parsing phase:');
    const parser = new UcodeParser(tokens);
    const result = parser.parse();
    
    if (result.errors && result.errors.length > 0) {
        console.log('❌ Parser errors:');
        result.errors.forEach(error => {
            console.log(`  - ${error.message} at ${error.start}-${error.end}`);
        });
    } else {
        console.log('✅ Parsed successfully!');
        if (result.ast && result.ast.body.length > 0) {
            console.log('AST node type:', result.ast.body[0].type);
        }
    }
    
} catch (error) {
    console.log('❌ Exception during parsing:', error.message);
    console.log('Stack:', error.stack);
}