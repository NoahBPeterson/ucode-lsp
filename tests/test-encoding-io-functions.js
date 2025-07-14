// Unit test for encoding and I/O function validations

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_NUMBER: 3,
    TK_DOUBLE: 4,
    TK_STRING: 5,
    TK_COMMA: 6
};

function isNumericToken(token) {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

// Test cases for encoding and I/O function validations
const testCases = [
    // Base64 encoding functions
    {
        name: "b64enc with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'b64enc', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 7, end: 10 }
        ],
        shouldError: true,
        validationType: 'encoding'
    },
    {
        name: "b64enc with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'b64enc', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 7, end: 13 }
        ],
        shouldError: true,
        validationType: 'encoding'
    },
    {
        name: "b64dec with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'b64dec', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '789', pos: 7, end: 10 }
        ],
        shouldError: true,
        validationType: 'encoding'
    },
    {
        name: "b64dec with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'b64dec', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_DOUBLE, value: '101.5', pos: 7, end: 12 }
        ],
        shouldError: true,
        validationType: 'encoding'
    },
    
    // I/O functions
    {
        name: "printf with number as format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'printf', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 7, end: 10 }
        ],
        shouldError: true,
        validationType: 'io'
    },
    {
        name: "printf with double as format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'printf', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 7, end: 13 }
        ],
        shouldError: true,
        validationType: 'io'
    },
    {
        name: "sprintf with number as format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sprintf', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_NUMBER, value: '789', pos: 8, end: 11 }
        ],
        shouldError: true,
        validationType: 'io'
    },
    {
        name: "sprintf with double as format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sprintf', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_DOUBLE, value: '101.5', pos: 8, end: 13 }
        ],
        shouldError: true,
        validationType: 'io'
    },
    
    // Valid cases
    {
        name: "b64enc with valid string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'b64enc', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 7, end: 14 }
        ],
        shouldError: false,
        validationType: 'encoding'
    },
    {
        name: "b64dec with valid string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'b64dec', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"aGVsbG8="', pos: 7, end: 17 }
        ],
        shouldError: false,
        validationType: 'encoding'
    },
    {
        name: "printf with valid format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'printf', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"Hello %s"', pos: 7, end: 17 }
        ],
        shouldError: false,
        validationType: 'io'
    },
    {
        name: "sprintf with valid format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sprintf', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_STRING, value: '"Value: %d"', pos: 8, end: 19 }
        ],
        shouldError: false,
        validationType: 'io'
    },
    {
        name: "printf with variable format string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'printf', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LABEL, value: 'formatStr', pos: 7, end: 16 }
        ],
        shouldError: false,
        validationType: 'io'
    }
];

function testEncodingIOValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // Encoding functions
        if (validationType === 'encoding') {
            const encodingFunctions = ['b64enc', 'b64dec', 'hexenc', 'hexdec'];
            if (encodingFunctions.includes(funcName) && isNumericToken(firstParam)) {
                foundError = true;
            }
        }
        
        // I/O functions
        if (validationType === 'io') {
            const ioFunctions = ['printf', 'sprintf'];
            if (ioFunctions.includes(funcName) && isNumericToken(firstParam)) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Encoding & I/O Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testEncodingIOValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All encoding & I/O validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for encoding and I/O functions.');