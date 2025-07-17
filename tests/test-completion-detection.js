// Test completion detection logic
import { UcodeLexer, TokenType } from '../src/lexer';

// Mock the completion detection function - updated version
function detectMemberCompletionContext(offset, tokens) {
    // Look for pattern: LABEL DOT (cursor position)
    // We want to find tokens that come just before the cursor position
    
    let dotTokenIndex = -1;
    let labelTokenIndex = -1;
    
    // Find the most recent DOT token before or at the cursor
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.type === TokenType.TK_DOT && token.pos < offset) {
            dotTokenIndex = i;
            break;
        }
    }
    
    // If we found a dot, check if there's a LABEL token immediately before it
    if (dotTokenIndex > 0) {
        const dotToken = tokens[dotTokenIndex];
        const prevToken = tokens[dotTokenIndex - 1];
        
        // Check if previous token is a LABEL and it's immediately before the dot
        if (prevToken.type === TokenType.TK_LABEL && prevToken.end === dotToken.pos) {
            // Make sure the cursor is after the dot (for completion)
            if (offset > dotToken.end) {
                return {
                    objectName: prevToken.value
                };
            }
        }
    }
    
    return undefined;
}

// Test cases
const testCases = [
    {
        name: "fs. completion",
        code: "const fs = require('fs');\nfs.",
        cursorOffset: 30, // Right after the dot
        expectedObject: "fs"
    },
    {
        name: "fs.o completion (partial typing)",
        code: "const fs = require('fs');\nfs.o",
        cursorOffset: 31, // After typing "o"
        expectedObject: "fs"
    },
    {
        name: "other. completion",
        code: "const obj = {};\nobj.",
        cursorOffset: 21, // After the dot
        expectedObject: "obj"
    }
];

console.log('🧪 Testing Completion Detection Logic...\\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    console.log(`🧪 Testing ${testCase.name}:`);
    
    try {
        const lexer = new UcodeLexer(testCase.code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        console.log(`  Code: "${testCase.code}"`);
        console.log(`  Cursor offset: ${testCase.cursorOffset}`);
        console.log(`  Tokens around cursor:`);
        
        // Show tokens around the cursor
        tokens.forEach((token, index) => {
            const isNearCursor = Math.abs(token.pos - testCase.cursorOffset) <= 5;
            if (isNearCursor) {
                console.log(`    [${index}] ${token.type}: "${token.value}" at ${token.pos}-${token.end}`);
            }
        });
        
        const result = detectMemberCompletionContext(testCase.cursorOffset, tokens);
        
        console.log(`  Detection result:`, result);
        console.log(`  Expected object: ${testCase.expectedObject}`);
        
        const passed = result && result.objectName === testCase.expectedObject;
        console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        
        if (passed) {
            passedTests++;
        }
        
    } catch (error) {
        console.log(`  ❌ ERROR: ${error.message}`);
    }
    
    console.log('');
});

console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All completion detection tests passed!');
} else {
    console.log('❌ Some tests failed. Check completion detection logic.');
}