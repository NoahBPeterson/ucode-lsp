// Unit test for conversion function validations

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
    TK_LBRACE: 9
};

function isArrayToken(token) {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token) {
    return token.type === TokenType.TK_LBRACE;
}

// Test cases for conversion function validations
const testCases = [
    // int() function tests - should error with arrays and objects
    {
        name: "int with array parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'int', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 4, end: 5 }
        ],
        shouldError: true,
        validationType: 'int'
    },
    {
        name: "int with object parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'int', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_LBRACE, value: '{', pos: 4, end: 5 }
        ],
        shouldError: true,
        validationType: 'int'
    },
    
    // int() function tests - should NOT error with strings and numbers
    {
        name: "int with valid string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'int', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"123"', pos: 4, end: 9 }
        ],
        shouldError: false,
        validationType: 'int'
    },
    {
        name: "int with valid number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'int', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 4, end: 7 }
        ],
        shouldError: false,
        validationType: 'int'
    },
    {
        name: "int with valid double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'int', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_DOUBLE, value: '123.45', pos: 4, end: 10 }
        ],
        shouldError: false,
        validationType: 'int'
    },
    {
        name: "int with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'int', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_LABEL, value: 'value', pos: 4, end: 9 }
        ],
        shouldError: false,
        validationType: 'int'
    }
];

function testConversionValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // int function validation
        if (validationType === 'int' && funcName === 'int') {
            if (isArrayToken(firstParam) || isObjectToken(firstParam)) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Conversion Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testConversionValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All conversion function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for conversion functions.');