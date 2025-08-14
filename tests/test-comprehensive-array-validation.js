// Comprehensive test suite for precise array parameter validation
console.log('🔧 Running Comprehensive Array Validation Tests...\n');

const { UcodeLexer } = require('../src/lexer/ucodeLexer');
const { validateArrayFunctions } = require('../src/validations/array-functions');
const { TextDocument } = require('vscode-languageserver-textdocument');

const testCases = [
    // SHOULD BE VALID - no false positives
    {
        name: "Array literal",
        code: "push([], 1);",
        shouldError: false,
        description: "Array literal is definitely valid"
    },
    {
        name: "Variable reference",
        code: "push(arr, 1);",
        shouldError: false,
        description: "Variable could be an array"
    },
    {
        name: "Assignment with array literal",
        code: "push(arr = [], 1);",
        shouldError: false,
        description: "Assignment with array literal is valid"
    },
    {
        name: "Nullish coalescing with array",
        code: "push(arr ??= [], 1);",
        shouldError: false,
        description: "Nullish coalescing with array is valid"
    },
    {
        name: "Array-returning function",
        code: "push(split('a,b', ','), 1);",
        shouldError: false,
        description: "split() returns an array"
    },
    {
        name: "Complex valid expression",
        code: "push(testcases ??= [], { name: 'test' });",
        shouldError: false,
        description: "Your original expression should be valid"
    },
    {
        name: "Parenthesized array operation",
        code: "push((arr || []), 1);",
        shouldError: false,
        description: "Parenthesized expression with array fallback"
    },
    
    // SHOULD BE INVALID - catch real errors
    {
        name: "Number literal",
        code: "push(123, 1);",
        shouldError: true,
        expectedError: "number",
        description: "Numbers are never arrays"
    },
    {
        name: "String literal",
        code: "push('hello', 1);",
        shouldError: true,
        expectedError: "string",
        description: "Strings are never arrays"
    },
    {
        name: "Boolean literal",
        code: "push(true, 1);",
        shouldError: true,
        expectedError: "boolean",
        description: "Booleans are never arrays"
    },
    {
        name: "Null literal",
        code: "push(null, 1);",
        shouldError: true,
        expectedError: "null",
        description: "Null is never an array"
    },
    {
        name: "Regex literal",
        code: "push(/pattern/, 1);",
        shouldError: true,
        expectedError: "regex",
        description: "Regex literals are never arrays"
    },
    {
        name: "Non-array returning function",
        code: "push(join(',', arr), 1);",
        shouldError: true,
        expectedError: "function returns non-array",
        description: "join() returns a string, not an array"
    },
    {
        name: "Assignment with number",
        code: "push(x = 123, 1);",
        shouldError: true,
        expectedError: "number",
        description: "Assignment with non-array value"
    },
    {
        name: "Assignment with string",
        code: "push(x = 'hello', 1);",
        shouldError: true,
        expectedError: "string",
        description: "Assignment with string literal"
    },
    
    // EDGE CASES - test precision
    {
        name: "Parenthesized number (simple)",
        code: "push((123), 1);",
        shouldError: true,
        expectedError: "number",
        description: "Parentheses don't make numbers into arrays"
    },
    {
        name: "Unknown function call",
        code: "push(unknownFunc(), 1);",
        shouldError: false,
        description: "Unknown functions might return arrays"
    },
    {
        name: "Member expression",
        code: "push(obj.property, 1);",
        shouldError: false,
        description: "Object properties might be arrays"
    },
    {
        name: "Computed member",
        code: "push(obj[key], 1);",
        shouldError: false,
        description: "Computed properties might be arrays"
    },
    
    // JOIN FUNCTION TESTS
    {
        name: "Valid join call",
        code: "join(',', arr);",
        shouldError: false,
        description: "join with array variable is valid"
    },
    {
        name: "Invalid join with number",
        code: "join(',', 123);",
        shouldError: true,
        expectedError: "number",
        description: "join second parameter must be array"
    }
];

function testArrayValidationPrecision(testName, code, shouldError, expectedError, description) {
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
                    diagnostics.some(d => d.message.toLowerCase().includes(expectedError.toLowerCase())) : true;
                
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
                console.log(`  Result: ❌ FAIL - FALSE POSITIVE: Should not error on valid syntax`);
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
let falsePositives = 0;
let falseNegatives = 0;

testCases.forEach((testCase) => {
    totalTests++;
    const result = testArrayValidationPrecision(
        testCase.name,
        testCase.code,
        testCase.shouldError,
        testCase.expectedError,
        testCase.description
    );
    
    if (result) {
        passedTests++;
    } else {
        // Track type of failure
        if (testCase.shouldError) {
            falseNegatives++; // Should have caught error but didn't
        } else {
            falsePositives++; // Should not have errored but did
        }
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
console.log(`❌ False Positives: ${falsePositives} (valid code flagged as error)`);
console.log(`❌ False Negatives: ${falseNegatives} (invalid code not caught)`);

if (passedTests === totalTests) {
    console.log('🎉 All comprehensive array validation tests passed!');
    console.log('✅ LSP validation is precise - no false positives or negatives!');
} else {
    console.log('❌ LSP validation needs improvement for precision.');
    process.exit(1);
}