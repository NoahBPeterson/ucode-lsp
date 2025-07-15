// Unit test for JSON utility function validations

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

function isStringToken(token) {
    return token.type === TokenType.TK_STRING;
}

// Test cases for JSON utility function validations
const testCases = [
    // json() function tests - should NOT error with any type (accepts any data)
    {
        name: "json with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'json', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 5, end: 8 }
        ],
        shouldError: false,
        validationType: 'json'
    },
    {
        name: "json with array parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'json', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 5, end: 6 }
        ],
        shouldError: false,
        validationType: 'json'
    },
    {
        name: "json with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'json', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"test"', pos: 5, end: 11 }
        ],
        shouldError: false,
        validationType: 'json'
    },
    
    // call() function tests
    {
        name: "call with number as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'call', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 5, end: 8 }
        ],
        shouldError: true,
        validationType: 'call'
    },
    {
        name: "call with string as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'call', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"func"', pos: 5, end: 11 }
        ],
        shouldError: true,
        validationType: 'call'
    },
    {
        name: "call with array as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'call', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 5, end: 6 }
        ],
        shouldError: true,
        validationType: 'call'
    },
    
    // signal() function tests
    {
        name: "signal with string as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'signal', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"SIGTERM"', pos: 7, end: 16 }
        ],
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with valid number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'signal', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '15', pos: 7, end: 9 }
        ],
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with array as first parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'signal', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 7, end: 8 }
        ],
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with number and string as second parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'signal', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '15', pos: 7, end: 9 },
            { type: TokenType.TK_COMMA, value: ',', pos: 9, end: 10 },
            { type: TokenType.TK_STRING, value: '"handler"', pos: 11, end: 20 }
        ],
        shouldError: true,
        validationType: 'signal'
    }
];

function testJSONUtilityValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // json function validation - accepts any type, so no validation needed
        if (validationType === 'json' && funcName === 'json') {
            // json accepts any type for data, so never error
            foundError = false;
        }
        
        // call function validation
        if (validationType === 'call' && funcName === 'call') {
            if (isNumericToken(firstParam) || isArrayToken(firstParam) || isObjectToken(firstParam) || isStringToken(firstParam)) {
                foundError = true;
            }
        }
        
        // signal function validation
        if (validationType === 'signal' && funcName === 'signal') {
            if (isArrayToken(firstParam) || isObjectToken(firstParam) || isStringToken(firstParam)) {
                foundError = true;
            } else {
                // Check second parameter if there's a comma
                const commaToken = tokens[3];
                if (commaToken?.type === TokenType.TK_COMMA) {
                    const secondParam = tokens[4];
                    if (secondParam && (isNumericToken(secondParam) || isArrayToken(secondParam) || isObjectToken(secondParam) || isStringToken(secondParam))) {
                        foundError = true;
                    }
                }
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing JSON Utility Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testJSONUtilityValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All JSON utility function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for JSON utility functions.');