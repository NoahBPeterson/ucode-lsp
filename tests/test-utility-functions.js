// Unit test for utility function validations

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_NUMBER: 3,
    TK_DOUBLE: 4,
    TK_STRING: 5,
    TK_COMMA: 6,
    TK_LBRACK: 7
};

function isStringToken(token) {
    return token.type === TokenType.TK_STRING;
}

function isArrayToken(token) {
    return token.type === TokenType.TK_LBRACK;
}

// Test cases for utility function validations
const testCases = [
    // min() function tests
    {
        name: "min with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'min', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"5"', pos: 4, end: 7 }
        ],
        shouldError: true,
        validationType: 'min'
    },
    {
        name: "min with multiple string parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'min', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"10"', pos: 4, end: 8 },
            { type: TokenType.TK_COMMA, value: ',', pos: 8, end: 9 },
            { type: TokenType.TK_STRING, value: '"20"', pos: 10, end: 14 }
        ],
        shouldError: true,
        validationType: 'min'
    },
    {
        name: "min with valid number parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'min', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_NUMBER, value: '5', pos: 4, end: 5 }
        ],
        shouldError: false,
        validationType: 'min'
    },
    {
        name: "min with valid double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'min', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_DOUBLE, value: '3.14', pos: 4, end: 8 }
        ],
        shouldError: false,
        validationType: 'min'
    },
    {
        name: "min with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'min', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_LABEL, value: 'values', pos: 4, end: 10 }
        ],
        shouldError: false,
        validationType: 'min'
    },
    
    // max() function tests
    {
        name: "max with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'max', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"10"', pos: 4, end: 8 }
        ],
        shouldError: true,
        validationType: 'max'
    },
    {
        name: "max with multiple string parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'max', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"50"', pos: 4, end: 8 },
            { type: TokenType.TK_COMMA, value: ',', pos: 8, end: 9 },
            { type: TokenType.TK_STRING, value: '"75"', pos: 10, end: 14 }
        ],
        shouldError: true,
        validationType: 'max'
    },
    {
        name: "max with valid number parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'max', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_NUMBER, value: '10', pos: 4, end: 6 }
        ],
        shouldError: false,
        validationType: 'max'
    },
    {
        name: "max with valid double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'max', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_DOUBLE, value: '9.99', pos: 4, end: 8 }
        ],
        shouldError: false,
        validationType: 'max'
    },
    
    // uniq() function tests
    {
        name: "uniq with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uniq', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"array"', pos: 5, end: 12 }
        ],
        shouldError: true,
        validationType: 'uniq'
    },
    {
        name: "uniq with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uniq', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 5, end: 8 }
        ],
        shouldError: false, // Only checking for string error in current implementation
        validationType: 'uniq'
    },
    {
        name: "uniq with array literal",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uniq', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 5, end: 6 }
        ],
        shouldError: false,
        validationType: 'uniq'
    },
    {
        name: "uniq with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uniq', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LABEL, value: 'myArray', pos: 5, end: 12 }
        ],
        shouldError: false,
        validationType: 'uniq'
    }
];

function testUtilityValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // min/max function validation
        if ((validationType === 'min' || validationType === 'max') && 
            (funcName === 'min' || funcName === 'max')) {
            // Check all parameters from index 2 until we hit RPAREN
            let paramIndex = 2;
            while (paramIndex < tokens.length && tokens[paramIndex].type !== TokenType.TK_RPAREN) {
                const paramToken = tokens[paramIndex];
                if (paramToken && isStringToken(paramToken)) {
                    foundError = true;
                    break; // Found at least one error
                }
                paramIndex++;
                // Skip comma tokens
                if (paramIndex < tokens.length && tokens[paramIndex].type === TokenType.TK_COMMA) {
                    paramIndex++;
                }
            }
        }
        
        // uniq function validation
        if (validationType === 'uniq' && funcName === 'uniq') {
            if (isStringToken(firstParam)) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Utility Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testUtilityValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All utility function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for utility functions.');