// Unit test for string/character function validations

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

// Test cases for string and character function validations
const testCases = [
    // String functions with wrong parameter types
    {
        name: "uc with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uc', pos: 0, end: 2 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 2, end: 3 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 3, end: 6 }
        ],
        shouldError: true,
        validationType: 'string-functions'
    },
    {
        name: "lc with double parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'lc', pos: 0, end: 2 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 2, end: 3 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 3, end: 9 }
        ],
        shouldError: true,
        validationType: 'string-functions'
    },
    
    // Character functions with wrong parameter types
    {
        name: "chr with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'chr', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 4, end: 11 }
        ],
        shouldError: true,
        validationType: 'character-functions'
    },
    {
        name: "ord with number parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'ord', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_NUMBER, value: '789', pos: 4, end: 7 }
        ],
        shouldError: true,
        validationType: 'character-functions'
    },
    {
        name: "uchr with string parameter",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uchr', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"world"', pos: 5, end: 12 }
        ],
        shouldError: true,
        validationType: 'character-functions'
    },
    
    // Split function with wrong parameter types
    {
        name: "split with number as first param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'split', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 6, end: 9 }
        ],
        shouldError: true,
        validationType: 'split-function'
    },
    {
        name: "split with number as second param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'split', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 6, end: 13 },
            { type: TokenType.TK_COMMA, value: ',', pos: 13, end: 14 },
            { type: TokenType.TK_NUMBER, value: '456', pos: 15, end: 18 }
        ],
        shouldError: true,
        validationType: 'split-function'
    },
    
    // Replace function with wrong parameter types
    {
        name: "replace with number as first param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'replace', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 8, end: 11 }
        ],
        shouldError: true,
        validationType: 'replace-function'
    },
    {
        name: "replace with number as third param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'replace', pos: 0, end: 7 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 7, end: 8 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 8, end: 15 },
            { type: TokenType.TK_COMMA, value: ',', pos: 15, end: 16 },
            { type: TokenType.TK_STRING, value: '"old"', pos: 17, end: 22 },
            { type: TokenType.TK_COMMA, value: ',', pos: 22, end: 23 },
            { type: TokenType.TK_NUMBER, value: '789', pos: 24, end: 27 }
        ],
        shouldError: true,
        validationType: 'replace-function'
    },
    
    // Valid cases
    {
        name: "uc with valid string",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'uc', pos: 0, end: 2 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 2, end: 3 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 3, end: 10 }
        ],
        shouldError: false,
        validationType: 'string-functions'
    },
    {
        name: "chr with valid number",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'chr', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_NUMBER, value: '65', pos: 4, end: 6 }
        ],
        shouldError: false,
        validationType: 'character-functions'
    },
    {
        name: "split with valid parameters",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'split', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_STRING, value: '"hello,world"', pos: 6, end: 19 },
            { type: TokenType.TK_COMMA, value: ',', pos: 19, end: 20 },
            { type: TokenType.TK_STRING, value: '","', pos: 21, end: 24 }
        ],
        shouldError: false,
        validationType: 'split-function'
    }
];

function testStringCharValidations(testName, tokens, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + params
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // String functions that expect string parameter
        if (validationType === 'string-functions') {
            const stringFunctions = ['uc', 'lc', 'trim', 'ltrim', 'rtrim'];
            if (stringFunctions.includes(funcName) && isNumericToken(firstParam)) {
                foundError = true;
            }
        }
        
        // Character functions
        if (validationType === 'character-functions') {
            if (funcName === 'chr' || funcName === 'uchr') {
                if (firstParam.type === TokenType.TK_STRING) {
                    foundError = true;
                }
            } else if (funcName === 'ord') {
                if (isNumericToken(firstParam)) {
                    foundError = true;
                }
            }
        }
        
        // Split function
        if (validationType === 'split-function' && funcName === 'split') {
            if (isNumericToken(firstParam)) {
                foundError = true;
            }
            // Check second parameter
            if (tokens.length >= 5) {
                const secondParam = tokens[4];
                if (secondParam && isNumericToken(secondParam)) {
                    foundError = true;
                }
            }
        }
        
        // Replace function
        if (validationType === 'replace-function' && funcName === 'replace') {
            if (isNumericToken(firstParam)) {
                foundError = true;
            }
            // Check third parameter (if exists)
            if (tokens.length >= 7) {
                const thirdParam = tokens[6];
                if (thirdParam && isNumericToken(thirdParam)) {
                    foundError = true;
                }
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing String & Character Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testStringCharValidations(testCase.name, testCase.tokens, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All string & character validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for string and character functions.');