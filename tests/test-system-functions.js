// Unit test for system function validations

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

function isStringToken(token) {
    return token.type === TokenType.TK_STRING;
}

// Test cases for system function validations
const testCases = [
    // system() function tests
    {
        name: "system with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'system', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 7, end: 10 }
        ],
        shouldError: true,
        validationType: 'system'
    },
    {
        name: "system with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'system', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 7, end: 13 }
        ],
        shouldError: true,
        validationType: 'system'
    },
    {
        name: "system with valid string command",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'system', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"ls -la"', pos: 7, end: 15 }
        ],
        shouldError: false,
        validationType: 'system'
    },
    {
        name: "system with variable command",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'system', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LABEL, value: 'command', pos: 7, end: 14 }
        ],
        shouldError: false,
        validationType: 'system'
    },
    
    // sleep() function tests
    {
        name: "sleep with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sleep', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_STRING, value: '"5"', pos: 6, end: 9 }
        ],
        shouldError: true,
        validationType: 'sleep'
    },
    {
        name: "sleep with valid number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sleep', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_NUMBER, value: '5', pos: 6, end: 7 }
        ],
        shouldError: false,
        validationType: 'sleep'
    },
    {
        name: "sleep with valid double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sleep', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_DOUBLE, value: '2.5', pos: 6, end: 9 }
        ],
        shouldError: false,
        validationType: 'sleep'
    },
    {
        name: "sleep with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'sleep', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_LABEL, value: 'seconds', pos: 6, end: 13 }
        ],
        shouldError: false,
        validationType: 'sleep'
    }
];

function testSystemValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // System function validation
        if (validationType === 'system' && funcName === 'system') {
            if (isNumericToken(firstParam)) {
                foundError = true;
            }
        }
        
        // Sleep function validation
        if (validationType === 'sleep' && funcName === 'sleep') {
            if (isStringToken(firstParam)) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing System Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testSystemValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All system function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for system functions.');