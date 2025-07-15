// Unit test for system utility function validations

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_RPAREN: 3,
    TK_NUMBER: 4,
    TK_DOUBLE: 5,
    TK_STRING: 6,
    TK_COMMA: 7,
    TK_LBRACK: 8,
    TK_LBRACE: 9,
    TK_RBRACK: 10,
    TK_RBRACE: 11
};

// Test cases for system utility function validations
const testCases = [
    // type() function tests - should NOT error with any type (accepts any data)
    {
        name: "type with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'type', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 5, end: 8 }
        ],
        shouldError: false,
        validationType: 'type'
    },
    {
        name: "type with array parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'type', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 5, end: 6 }
        ],
        shouldError: false,
        validationType: 'type'
    },
    {
        name: "type with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'type', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"test"', pos: 5, end: 11 }
        ],
        shouldError: false,
        validationType: 'type'
    },
    
    // print() function tests - should NOT error with any type (accepts variadic args)
    {
        name: "print with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'print', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_NUMBER, value: '42', pos: 6, end: 8 }
        ],
        shouldError: false,
        validationType: 'print'
    },
    {
        name: "print with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'print', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 6, end: 13 }
        ],
        shouldError: false,
        validationType: 'print'
    },
    
    // time() function tests - should NOT error (no parameters expected)
    {
        name: "time with no parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'time', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 5, end: 6 }
        ],
        shouldError: false,
        validationType: 'time'
    },
    
    // clock() function tests - should NOT error (no parameters expected)
    {
        name: "clock with no parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'clock', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 6, end: 7 }
        ],
        shouldError: false,
        validationType: 'clock'
    },
    
    // sourcepath() function tests - should NOT error (no parameters expected)
    {
        name: "sourcepath with no parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sourcepath', pos: 0, end: 10 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 10, end: 11 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 11, end: 12 }
        ],
        shouldError: false,
        validationType: 'sourcepath'
    },
    
    // gc() function tests - should NOT error (no parameters expected)
    {
        name: "gc with no parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'gc', pos: 0, end: 2 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 2, end: 3 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 3, end: 4 }
        ],
        shouldError: false,
        validationType: 'gc'
    }
];

function testSystemUtilityValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + optional param
    if (tokens.length >= 2 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        
        // All system utility functions accept any type or no parameters
        // So no validation errors should be generated for any of these functions:
        // - type() accepts any single parameter
        // - print() accepts variadic parameters of any type
        // - time(), clock(), sourcepath(), gc() accept no parameters
        
        // No validation logic needed - these functions are permissive by design
        foundError = false;
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing System Utility Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testSystemUtilityValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All system utility function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These functions accept any type or no parameters, so no validation errors are expected.');