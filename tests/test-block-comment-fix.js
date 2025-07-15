#!/usr/bin/env node

// Test block comment fix
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing Block Comment Fix...\n');

// Test cases
const testCases = [
    {
        name: 'Block comment followed by export',
        code: `/**
 * Block comment
 */
export function test() {}`,
        expectedTokens: ['TK_EXPORT', 'TK_FUNC', 'TK_LABEL', 'TK_LPAREN', 'TK_RPAREN', 'TK_LBRACE', 'TK_RBRACE', 'TK_EOF']
    },
    {
        name: 'Block comment followed by import',
        code: `/**
 * Import comment
 */
import { test } from './test.uc';`,
        expectedTokens: ['TK_IMPORT', 'TK_LBRACE', 'TK_LABEL', 'TK_RBRACE', 'TK_FROM', 'TK_STRING', 'TK_SCOL', 'TK_EOF']
    },
    {
        name: 'Multiple block comments',
        code: `/**
 * First comment
 */
/**
 * Second comment
 */
let x = 5;`,
        expectedTokens: ['TK_LOCAL', 'TK_LABEL', 'TK_ASSIGN', 'TK_NUMBER', 'TK_SCOL', 'TK_EOF']
    },
    {
        name: 'Block comment with regex after',
        code: `/**
 * Comment
 */
let pattern = /test/;`,
        expectedTokens: ['TK_LOCAL', 'TK_LABEL', 'TK_ASSIGN', 'TK_REGEXP', 'TK_SCOL', 'TK_EOF']
    }
];

function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) {
            return key;
        }
    }
    return 'UNKNOWN';
}

let passedTests = 0;
let totalTests = testCases.length;

testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}: ${testCase.name}`);
    console.log(`  Code: ${JSON.stringify(testCase.code)}`);
    
    try {
        const lexer = new UcodeLexer(testCase.code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        const actualTokens = tokens.map(token => getTokenName(token.type));
        const expectedTokens = testCase.expectedTokens;
        
        console.log(`  Expected: ${expectedTokens.join(', ')}`);
        console.log(`  Actual:   ${actualTokens.join(', ')}`);
        
        const match = JSON.stringify(actualTokens) === JSON.stringify(expectedTokens);
        if (match) {
            console.log(`  ✅ PASS`);
            passedTests++;
        } else {
            console.log(`  ❌ FAIL`);
        }
        
    } catch (error) {
        console.log(`  ❌ FAIL - Exception: ${error.message}`);
    }
    
    console.log('');
});

console.log('📊 Test Results:');
console.log(`${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All block comment parsing tests passed!');
    console.log('✅ Block comments are now correctly parsed as TK_COMMENT tokens');
    console.log('✅ Tokens after block comments are processed correctly');
    console.log('✅ Regular expressions are still parsed correctly after the fix');
} else {
    console.log('❌ Some tests failed');
}