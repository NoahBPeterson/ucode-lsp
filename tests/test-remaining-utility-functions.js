// Unit test for remaining utility function validations

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

function isNumericToken(token) {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

function isArrayToken(token) {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token) {
    return token.type === TokenType.TK_LBRACE;
}

// Test cases for remaining utility function validations
const testCases = [
    // wildcard() function tests
    {
        name: "wildcard with number as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'wildcard', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 9, end: 12 }
        ],
        shouldError: true,
        validationType: 'wildcard'
    },
    {
        name: "wildcard with array as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'wildcard', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 9, end: 10 }
        ],
        shouldError: true,
        validationType: 'wildcard'
    },
    {
        name: "wildcard with valid string parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'wildcard', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_STRING, value: '"*.txt"', pos: 9, end: 16 },
            { type: TokenType.TK_COMMA, value: ',', pos: 16, end: 17 },
            { type: TokenType.TK_STRING, value: '"file.txt"', pos: 18, end: 28 }
        ],
        shouldError: false,
        validationType: 'wildcard'
    },
    {
        name: "wildcard with number as second parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'wildcard', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_STRING, value: '"*.txt"', pos: 9, end: 16 },
            { type: TokenType.TK_COMMA, value: ',', pos: 16, end: 17 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 18, end: 21 }
        ],
        shouldError: true,
        validationType: 'wildcard'
    },
    
    // regexp() function tests
    {
        name: "regexp with number as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'regexp', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '456', pos: 7, end: 10 }
        ],
        shouldError: true,
        validationType: 'regexp'
    },
    {
        name: "regexp with object as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'regexp', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LBRACE, value: '{', pos: 7, end: 8 }
        ],
        shouldError: true,
        validationType: 'regexp'
    },
    {
        name: "regexp with valid string parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'regexp', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"[0-9]+"', pos: 7, end: 15 },
            { type: TokenType.TK_COMMA, value: ',', pos: 15, end: 16 },
            { type: TokenType.TK_STRING, value: '"g"', pos: 17, end: 20 }
        ],
        shouldError: false,
        validationType: 'regexp'
    },
    {
        name: "regexp with array as second parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'regexp', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"[0-9]+"', pos: 7, end: 15 },
            { type: TokenType.TK_COMMA, value: ',', pos: 15, end: 16 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 17, end: 18 }
        ],
        shouldError: true,
        validationType: 'regexp'
    },
    
    // assert() function tests - should NOT error with any type
    {
        name: "assert with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'assert', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '1', pos: 7, end: 8 }
        ],
        shouldError: false,
        validationType: 'assert'
    },
    {
        name: "assert with array parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'assert', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 7, end: 8 }
        ],
        shouldError: false,
        validationType: 'assert'
    },
    {
        name: "assert with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'assert', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"test"', pos: 7, end: 13 }
        ],
        shouldError: false,
        validationType: 'assert'
    }
];

function testRemainingUtilityValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // wildcard function validation
        if (validationType === 'wildcard' && funcName === 'wildcard') {
            if (isNumericToken(firstParam) || isArrayToken(firstParam) || isObjectToken(firstParam)) {
                foundError = true;
            } else {
                // Check second parameter if there's a comma
                const commaToken = tokens[3];
                if (commaToken?.type === TokenType.TK_COMMA) {
                    const secondParam = tokens[4];
                    if (secondParam && (isNumericToken(secondParam) || isArrayToken(secondParam) || isObjectToken(secondParam))) {
                        foundError = true;
                    }
                }
            }
        }
        
        // regexp function validation
        if (validationType === 'regexp' && funcName === 'regexp') {
            if (isNumericToken(firstParam) || isArrayToken(firstParam) || isObjectToken(firstParam)) {
                foundError = true;
            } else {
                // Check second parameter if there's a comma
                const commaToken = tokens[3];
                if (commaToken?.type === TokenType.TK_COMMA) {
                    const secondParam = tokens[4];
                    if (secondParam && (isNumericToken(secondParam) || isArrayToken(secondParam) || isObjectToken(secondParam))) {
                        foundError = true;
                    }
                }
            }
        }
        
        // assert function validation - accepts any type, so no validation needed
        if (validationType === 'assert' && funcName === 'assert') {
            // assert accepts any type for condition, so never error
            foundError = false;
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Remaining Utility Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testRemainingUtilityValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All remaining utility function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for remaining utility functions.');