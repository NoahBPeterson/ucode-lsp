// Unit test for network function validations

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_RPAREN: 3,
    TK_NUMBER: 4,
    TK_DOUBLE: 5,
    TK_STRING: 6,
    TK_COMMA: 7,
    TK_LBRACK: 8
};

function isStringToken(token) {
    return token.type === TokenType.TK_STRING;
}

function isNumericToken(token) {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

// Test cases for network function validations
const testCases = [
    // iptoarr() function tests
    {
        name: "iptoarr with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'iptoarr', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_NUMBER, value: '192', pos: 8, end: 11 }
        ],
        shouldError: true,
        validationType: 'iptoarr'
    },
    {
        name: "iptoarr with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'iptoarr', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_DOUBLE, value: '192.168', pos: 8, end: 15 }
        ],
        shouldError: true,
        validationType: 'iptoarr'
    },
    {
        name: "iptoarr with valid string IP",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'iptoarr', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_STRING, value: '"192.168.1.1"', pos: 8, end: 21 }
        ],
        shouldError: false,
        validationType: 'iptoarr'
    },
    {
        name: "iptoarr with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'iptoarr', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_LABEL, value: 'ipAddress', pos: 8, end: 17 }
        ],
        shouldError: false,
        validationType: 'iptoarr'
    },
    
    // arrtoip() function tests
    {
        name: "arrtoip with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'arrtoip', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_STRING, value: '"192.168.1.1"', pos: 8, end: 21 }
        ],
        shouldError: true,
        validationType: 'arrtoip'
    },
    {
        name: "arrtoip with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'arrtoip', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_NUMBER, value: '192', pos: 8, end: 11 }
        ],
        shouldError: true,
        validationType: 'arrtoip'
    },
    {
        name: "arrtoip with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'arrtoip', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_DOUBLE, value: '192.168', pos: 8, end: 15 }
        ],
        shouldError: true,
        validationType: 'arrtoip'
    },
    {
        name: "arrtoip with array literal",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'arrtoip', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 8, end: 9 }
        ],
        shouldError: false,
        validationType: 'arrtoip'
    },
    {
        name: "arrtoip with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'arrtoip', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_LABEL, value: 'ipArray', pos: 8, end: 15 }
        ],
        shouldError: false,
        validationType: 'arrtoip'
    }
];

function testNetworkValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // iptoarr function validation
        if (validationType === 'iptoarr' && funcName === 'iptoarr') {
            if (isNumericToken(firstParam)) {
                foundError = true;
            }
        }
        
        // arrtoip function validation
        if (validationType === 'arrtoip' && funcName === 'arrtoip') {
            if (isStringToken(firstParam) || isNumericToken(firstParam)) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Network Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testNetworkValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All network function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for network functions.');