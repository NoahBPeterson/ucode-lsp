// Unit test for date/time function validations

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

// Test cases for date/time function validations
const testCases = [
    // localtime() function tests
    {
        name: "localtime with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'localtime', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_STRING, value: '"123456"', pos: 10, end: 18 }
        ],
        shouldError: true,
        validationType: 'localtime'
    },
    {
        name: "localtime with valid number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'localtime', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_NUMBER, value: '1640995200', pos: 10, end: 20 }
        ],
        shouldError: false,
        validationType: 'localtime'
    },
    {
        name: "localtime with no parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'localtime', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 10, end: 11 }
        ],
        shouldError: false,
        validationType: 'localtime'
    },
    {
        name: "localtime with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'localtime', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_LABEL, value: 'timestamp', pos: 10, end: 19 }
        ],
        shouldError: false,
        validationType: 'localtime'
    },
    
    // gmtime() function tests
    {
        name: "gmtime with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'gmtime', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"timestamp"', pos: 7, end: 18 }
        ],
        shouldError: true,
        validationType: 'gmtime'
    },
    {
        name: "gmtime with valid number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'gmtime', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '1640995200', pos: 7, end: 17 }
        ],
        shouldError: false,
        validationType: 'gmtime'
    },
    {
        name: "gmtime with no parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'gmtime', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 7, end: 8 }
        ],
        shouldError: false,
        validationType: 'gmtime'
    },
    
    // timelocal() function tests
    {
        name: "timelocal with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timelocal', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_STRING, value: '"array"', pos: 10, end: 17 }
        ],
        shouldError: true,
        validationType: 'timelocal'
    },
    {
        name: "timelocal with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timelocal', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 10, end: 13 }
        ],
        shouldError: true,
        validationType: 'timelocal'
    },
    {
        name: "timelocal with array literal",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timelocal', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 10, end: 11 }
        ],
        shouldError: false,
        validationType: 'timelocal'
    },
    {
        name: "timelocal with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timelocal', pos: 0, end: 9 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 9, end: 10 },
            { type: TokenType.TK_LABEL, value: 'timeArray', pos: 10, end: 19 }
        ],
        shouldError: false,
        validationType: 'timelocal'
    },
    
    // timegm() function tests
    {
        name: "timegm with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timegm', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"array"', pos: 7, end: 14 }
        ],
        shouldError: true,
        validationType: 'timegm'
    },
    {
        name: "timegm with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timegm', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '456', pos: 7, end: 10 }
        ],
        shouldError: true,
        validationType: 'timegm'
    },
    {
        name: "timegm with array literal",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timegm', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 7, end: 8 }
        ],
        shouldError: false,
        validationType: 'timegm'
    },
    {
        name: "timegm with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'timegm', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LABEL, value: 'gmtArray', pos: 7, end: 15 }
        ],
        shouldError: false,
        validationType: 'timegm'
    }
];

function testDateTimeValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // localtime/gmtime function validation
        if ((validationType === 'localtime' || validationType === 'gmtime') && 
            (funcName === 'localtime' || funcName === 'gmtime')) {
            // Only error if there's a parameter and it's a string (should be number or empty)
            if (firstParam && 
                firstParam.type !== TokenType.TK_RPAREN && 
                isStringToken(firstParam)) {
                foundError = true;
            }
        }
        
        // timelocal/timegm function validation
        if ((validationType === 'timelocal' || validationType === 'timegm') && 
            (funcName === 'timelocal' || funcName === 'timegm')) {
            if (firstParam && (isStringToken(firstParam) || isNumericToken(firstParam))) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Date/Time Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testDateTimeValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All date/time function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for date/time functions.');