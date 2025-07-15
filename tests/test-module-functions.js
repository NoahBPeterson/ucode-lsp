// Unit test for module function validations

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

function isNumericToken(token) {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

function isArrayToken(token) {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token) {
    return token.type === TokenType.TK_LBRACE;
}

// Test cases for module function validations
const testCases = [
    // require() function tests
    {
        name: "require with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'require', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 8, end: 11 }
        ],
        shouldError: true,
        validationType: 'require'
    },
    {
        name: "require with array parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'require', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 8, end: 9 }
        ],
        shouldError: true,
        validationType: 'require'
    },
    {
        name: "require with valid string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'require', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_STRING, value: '"./module"', pos: 8, end: 18 }
        ],
        shouldError: false,
        validationType: 'require'
    },
    
    // include() function tests
    {
        name: "include with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'include', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_DOUBLE, value: '12.34', pos: 8, end: 13 }
        ],
        shouldError: true,
        validationType: 'include'
    },
    {
        name: "include with object parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'include', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_LBRACE, value: '{', pos: 8, end: 9 }
        ],
        shouldError: true,
        validationType: 'include'
    },
    {
        name: "include with valid string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'include', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_STRING, value: '"config.uc"', pos: 8, end: 19 }
        ],
        shouldError: false,
        validationType: 'include'
    },
    
    // loadstring() function tests
    {
        name: "loadstring with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'loadstring', pos: 0, end: 10 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 10, end: 11 },
            { type: TokenType.TK_NUMBER, value: '456', pos: 11, end: 14 }
        ],
        shouldError: true,
        validationType: 'loadstring'
    },
    {
        name: "loadstring with valid string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'loadstring', pos: 0, end: 10 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 10, end: 11 },
            { type: TokenType.TK_STRING, value: '"return 42"', pos: 11, end: 22 }
        ],
        shouldError: false,
        validationType: 'loadstring'
    },
    
    // loadfile() function tests
    {
        name: "loadfile with array parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'loadfile', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_LBRACK, value: '[', pos: 9, end: 10 }
        ],
        shouldError: true,
        validationType: 'loadfile'
    },
    {
        name: "loadfile with valid string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'loadfile', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_STRING, value: '"script.uc"', pos: 9, end: 20 }
        ],
        shouldError: false,
        validationType: 'loadfile'
    },
    {
        name: "loadfile with variable parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'loadfile', pos: 0, end: 8 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 8, end: 9 },
            { type: TokenType.TK_LABEL, value: 'filename', pos: 9, end: 17 }
        ],
        shouldError: false,
        validationType: 'loadfile'
    }
];

function testModuleValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + param
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // Module function validation
        const moduleFunctions = ['require', 'include', 'loadstring', 'loadfile'];
        if (moduleFunctions.includes(funcName)) {
            if (isNumericToken(firstParam) || isArrayToken(firstParam) || isObjectToken(firstParam)) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Module Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testModuleValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All module function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for module functions.');