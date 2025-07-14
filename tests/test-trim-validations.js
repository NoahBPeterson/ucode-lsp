// Unit test for trim function validations

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

// Test cases for trim function validations
const testCases = [
    {
        name: "trim with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'trim', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 5, end: 8 }
        ],
        shouldError: true
    },
    {
        name: "trim with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'trim', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 5, end: 11 }
        ],
        shouldError: true
    },
    {
        name: "ltrim with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'ltrim', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_NUMBER, value: '789', pos: 6, end: 9 }
        ],
        shouldError: true
    },
    {
        name: "rtrim with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'rtrim', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_DOUBLE, value: '101.5', pos: 6, end: 11 }
        ],
        shouldError: true
    },
    // Valid cases
    {
        name: "trim with valid string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'trim', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"  hello  "', pos: 5, end: 16 }
        ],
        shouldError: false
    },
    {
        name: "ltrim with valid string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'ltrim', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_STRING, value: '"  hello"', pos: 6, end: 15 }
        ],
        shouldError: false
    },
    {
        name: "rtrim with variable",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'rtrim', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_LABEL, value: 'myString', pos: 6, end: 14 }
        ],
        shouldError: false
    }
];

function testTrimValidations(testName, tokens, shouldError) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // Trim functions that expect string parameter
        const trimFunctions = ['trim', 'ltrim', 'rtrim'];
        if (trimFunctions.includes(funcName) && isNumericToken(firstParam)) {
            foundError = true;
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Trim Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testTrimValidations(testCase.name, testCase.tokens, testCase.shouldError)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All trim validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for trim functions.');