// Unit test for array function validations

// Mock TextDocument
const mockDocument = {
    positionAt: (offset) => ({ line: 0, character: offset }),
    getText: () => 'test content'
};

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

// Test cases for array function validations
const testCases = [
    // Basic array functions with wrong first parameter
    {
        name: "push with string as first param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'push', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '"string"', pos: 5, end: 13 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    {
        name: "push with number as first param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'push', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 5, end: 8 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    {
        name: "push with double as first param", 
        tokens: [
            { type: TokenType.TK_LABEL, value: 'push', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 5, end: 11 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    {
        name: "pop with string as first param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'pop', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_STRING, value: '"string"', pos: 4, end: 12 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    // Filter/map with wrong parameters
    {
        name: "filter with string as first param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'filter', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_STRING, value: '"string"', pos: 7, end: 15 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    {
        name: "filter with number as second param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'filter', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LABEL, value: 'arr', pos: 7, end: 10 },
            { type: TokenType.TK_COMMA, value: ',', pos: 10, end: 11 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 12, end: 15 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    {
        name: "map with double as second param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'map', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 3, end: 4 },
            { type: TokenType.TK_LABEL, value: 'arr', pos: 4, end: 7 },
            { type: TokenType.TK_COMMA, value: ',', pos: 7, end: 8 },
            { type: TokenType.TK_DOUBLE, value: '456.78', pos: 9, end: 15 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    // Join function (special parameter order)
    {
        name: "join with number as second param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'join', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_STRING, value: '","', pos: 5, end: 8 },
            { type: TokenType.TK_COMMA, value: ',', pos: 8, end: 9 },
            { type: TokenType.TK_NUMBER, value: '123', pos: 10, end: 13 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    // Slice with wrong parameter types
    {
        name: "slice with string as second param",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'slice', pos: 0, end: 5 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 5, end: 6 },
            { type: TokenType.TK_LABEL, value: 'arr', pos: 6, end: 9 },
            { type: TokenType.TK_COMMA, value: ',', pos: 9, end: 10 },
            { type: TokenType.TK_STRING, value: '"1"', pos: 11, end: 14 }
        ],
        shouldError: true,
        validationType: 'array-functions'
    },
    // Valid cases
    {
        name: "push with valid array",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'push', pos: 0, end: 4 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LABEL, value: 'myArray', pos: 5, end: 12 }
        ],
        shouldError: false,
        validationType: 'array-functions'
    },
    {
        name: "filter with valid array and function",
        tokens: [
            { type: TokenType.TK_LABEL, value: 'filter', pos: 0, end: 6 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 6, end: 7 },
            { type: TokenType.TK_LABEL, value: 'myArray', pos: 7, end: 14 },
            { type: TokenType.TK_COMMA, value: ',', pos: 14, end: 15 },
            { type: TokenType.TK_LABEL, value: 'myFunc', pos: 16, end: 22 }
        ],
        shouldError: false,
        validationType: 'array-functions'
    }
];

function testArrayValidations(testName, tokens, shouldError) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let foundError = false;
    
    // Check if we have the pattern: LABEL + LPAREN + params
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        
        // Array functions that expect array as first parameter
        const arrayFunctions = ['push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'sort', 'reverse', 'filter', 'map'];
        
        if (arrayFunctions.includes(funcName)) {
            if (firstParam.type === TokenType.TK_STRING || isNumericToken(firstParam)) {
                foundError = true;
            }
        }
        
        // Special case: join(separator, array) - check second parameter
        if (funcName === 'join' && tokens.length >= 5) {
            const secondParam = tokens[4];
            if (secondParam && (secondParam.type === TokenType.TK_STRING || isNumericToken(secondParam))) {
                foundError = true;
            }
        }
        
        // Filter/map second parameter validation
        if ((funcName === 'filter' || funcName === 'map') && tokens.length >= 5) {
            const secondParam = tokens[4];
            if (secondParam && (secondParam.type === TokenType.TK_STRING || isNumericToken(secondParam))) {
                foundError = true;
            }
        }
        
        // Slice parameter validation
        if (funcName === 'slice' && tokens.length >= 5) {
            const secondParam = tokens[4];
            if (secondParam && secondParam.type === TokenType.TK_STRING) {
                foundError = true;
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Array Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testArrayValidations(testCase.name, testCase.tokens, testCase.shouldError)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All array validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for array functions.');