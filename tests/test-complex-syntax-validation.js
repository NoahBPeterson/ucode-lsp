// Test suite for complex syntax validation 
console.log('🔧 Running Complex Syntax Validation Tests...\n');

const { UcodeLexer } = require('../src/lexer/ucodeLexer');
const { validateArrayFunctions } = require('../src/validations/array-functions');
const { TextDocument } = require('vscode-languageserver-textdocument');

const testCases = [
    {
        name: "Valid: Simple array variable",
        code: "push(arr, 1);",
        shouldError: false,
        description: "Array variable should be valid"
    },
    {
        name: "Valid: Array literal",
        code: "push([], 1);",
        shouldError: false,
        description: "Array literal should be valid"
    },
    {
        name: "Valid: Nullish coalescing assignment with array",
        code: "push(arr ??= [], 1);",
        shouldError: false,
        description: "Nullish coalescing assignment should be valid"
    },
    {
        name: "Valid: Regular assignment with array",
        code: "push(arr = [], 1);",
        shouldError: false,
        description: "Assignment with array should be valid"
    },
    {
        name: "Valid: Parenthesized expression",
        code: "push((arr || []), 1);",
        shouldError: false,
        description: "Parenthesized expressions should be valid"
    },
    {
        name: "Valid: Complex expression from user example",
        code: "push(testcases ??= [], { name: 'test', code: section[1] });",
        shouldError: false,
        description: "Complex nullish coalescing with object parameter should be valid"
    },
    {
        name: "Invalid: Number as first parameter",
        code: "push(123, 1);",
        shouldError: true,
        expectedError: "first parameter should be an array, not a number",
        description: "Number should be rejected"
    },
    {
        name: "Invalid: String as first parameter", 
        code: "push('hello', 1);",
        shouldError: true,
        expectedError: "first parameter should be an array, not a string",
        description: "String should be rejected"
    },
    {
        name: "Invalid: Boolean as first parameter",
        code: "push(true, 1);",
        shouldError: true,
        expectedError: "first parameter should be an array, not a boolean",
        description: "Boolean should be rejected"
    },
    {
        name: "Invalid: Null as first parameter",
        code: "push(null, 1);",
        shouldError: true,
        expectedError: "first parameter should be an array, not a null",
        description: "Null should be rejected"
    },
    {
        name: "Valid: join with array variable",
        code: "join(',', arr);",
        shouldError: false,
        description: "join with array variable should be valid"
    },
    {
        name: "Invalid: join with number as second parameter",
        code: "join(',', 123);",
        shouldError: true,
        expectedError: "second parameter should be an array, not a number",
        description: "join with number should be rejected"
    }
];

function testComplexSyntaxValidation(testName, code, shouldError, expectedError, description) {
    console.log(`\n🧪 Testing ${testName}:`);
    console.log(`  Code: ${code}`);
    console.log(`  Description: ${description}`);
    
    try {
        // Create text document
        const textDocument = TextDocument.create('test://test.uc', 'ucode', 1, code);
        
        // Tokenize
        const lexer = new UcodeLexer(code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Run validation
        const diagnostics = [];
        validateArrayFunctions(textDocument, tokens, diagnostics);
        
        console.log(`  Diagnostics found: ${diagnostics.length}`);
        
        if (shouldError) {
            if (diagnostics.length > 0) {
                const hasExpectedError = expectedError ? 
                    diagnostics.some(d => d.message.includes(expectedError)) : true;
                
                if (hasExpectedError) {
                    console.log(`  Expected error found: ${diagnostics[0].message}`);
                    console.log(`  Result: ✅ PASS`);
                    return true;
                } else {
                    console.log(`  Expected error containing: ${expectedError}`);
                    console.log(`  Actual error: ${diagnostics[0].message}`);
                    console.log(`  Result: ❌ FAIL - Wrong error message`);
                    return false;
                }
            } else {
                console.log(`  Result: ❌ FAIL - Expected error but found none`);
                return false;
            }
        } else {
            if (diagnostics.length === 0) {
                console.log(`  Result: ✅ PASS - No errors as expected`);
                return true;
            } else {
                console.log(`  Unexpected error: ${diagnostics[0].message}`);
                console.log(`  Result: ❌ FAIL - Unexpected error found`);
                return false;
            }
        }
    } catch (error) {
        console.log(`  Result: ❌ FAIL - Exception: ${error.message}`);
        return false;
    }
}

// Run all tests
let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testComplexSyntaxValidation(
        testCase.name,
        testCase.code,
        testCase.shouldError,
        testCase.expectedError,
        testCase.description
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All complex syntax validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check the output above for details.');
    process.exit(1);
}