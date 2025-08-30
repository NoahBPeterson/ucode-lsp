// Unit test for system function validations

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_RPAREN: 3,
    TK_NUMBER: 4,
    TK_DOUBLE: 5,
    TK_STRING: 6,
    TK_COMMA: 7,
    TK_IDENT: 8,
    TK_LBRACE: 9,
    TK_LBRACK: 10,
    KW_NULL: 11,
    KW_TRUE: 12,
    KW_FALSE: 13,
};

function isInvalidSystemArg(token) {
    return token.type === TokenType.TK_LBRACE || token.type === TokenType.TK_NUMBER || token.type === TokenType.KW_NULL || token.type === TokenType.KW_TRUE;
}

function isInvalidTimeoutArg(token) {
    return token.type === TokenType.TK_LBRACE || token.type === TokenType.TK_LBRACK || token.type === TokenType.TK_STRING || token.type === TokenType.KW_NULL;
}

function isInvalidSleepType(token) {
    if (token.type === TokenType.TK_LBRACE || token.type === TokenType.TK_LBRACK) {
        return true;
    }
    if (token.type === TokenType.TK_STRING) {
        const numberLikeRegex = /^[+-]?(\d*\.?\d+|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO]?[0-7]+)$/;
        return !numberLikeRegex.test(token.value.replace(/"/g, ''));
    }
    return false;
}

// Test cases for system function validations
const testCases = [
    // system() function tests
    {
        name: "system with valid string parameter",
        code: `system(\"echo hello\")`,
        shouldError: false,
        validationType: 'system'
    },
    {
        name: "system with valid array parameter",
        code: `system([\"/bin/echo\", \"hello\"])`,
        shouldError: false,
        validationType: 'system'
    },
    {
        name: "system with invalid number parameter",
        code: "system(123)",
        shouldError: true,
        validationType: 'system'
    },
    {
        name: "system with invalid object parameter",
        code: "system({})",
        shouldError: true,
        validationType: 'system'
    },
    {
        name: "system with valid command and valid timeout",
        code: `system(\"sleep 1\", 1000)`,
        shouldError: false,
        validationType: 'system'
    },
    {
        name: "system with valid command and invalid timeout",
        code: `system(\"sleep 1\", \"1000\")`,
        shouldError: true,
        validationType: 'system'
    },
    
    // sleep() function tests
    {
        name: "sleep with valid number-like string parameter",
        code: `sleep(\"5\")`,
        shouldError: false,
        validationType: 'sleep'
    },
    {
        name: "sleep with non-numeric string parameter",
        code: `sleep(\"hello\")`,
        shouldError: true,
        validationType: 'sleep'
    },
    {
        name: "sleep with valid number parameter",
        code: "sleep(5)",
        shouldError: false,
        validationType: 'sleep'
    },
    {
        name: "sleep with valid double parameter",
        code: "sleep(2.5)",
        shouldError: false,
        validationType: 'sleep'
    },
    {
        name: "sleep with variable parameter",
        code: "sleep(seconds)",
        shouldError: false, // Cannot validate variable types in this test setup
        validationType: 'sleep'
    }
];

// A very simple mock parser to turn code string into tokens
function simpleParse(code) {
    const tokens = [];
    const funcNameMatch = code.match(/^(\w+)/);
    if (!funcNameMatch) return [];

    tokens.push({ type: TokenType.TK_LABEL, value: funcNameMatch[1] });
    tokens.push({ type: TokenType.TK_LPAREN });

    const argsStr = code.substring(code.indexOf('(') + 1, code.lastIndexOf(')'));
    if (!argsStr) return tokens;

    // This split is very basic and won't handle nested structures in args
    const args = argsStr.split(/\s*,\s*/);

    args.forEach((arg, index) => {
        if (index > 0) tokens.push({ type: TokenType.TK_COMMA });

        if (arg.startsWith('"') && arg.endsWith('"')) {
            tokens.push({ type: TokenType.TK_STRING, value: arg });
        } else if (arg.startsWith('[')) {
            tokens.push({ type: TokenType.TK_LBRACK, value: arg });
        } else if (arg.includes('.') && !isNaN(parseFloat(arg))) {
            tokens.push({ type: TokenType.TK_DOUBLE, value: arg });
        } else if (!isNaN(parseInt(arg, 10))) {
            tokens.push({ type: TokenType.TK_NUMBER, value: arg });
        } else if (arg === 'null') {
            tokens.push({ type: TokenType.KW_NULL, value: arg });
        } else if (arg === 'true') {
            tokens.push({ type: TokenType.KW_TRUE, value: arg });
        } else if (arg === 'false') {
            tokens.push({ type: TokenType.KW_FALSE, value: arg });
        } else if (arg.startsWith('{')) {
            tokens.push({ type: TokenType.TK_LBRACE, value: arg });
        } else {
            tokens.push({ type: TokenType.TK_IDENT, value: arg });
        }
    });

    tokens.push({ type: TokenType.TK_RPAREN });
    return tokens;
}

function testSystemValidations(testName, code, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const tokens = simpleParse(code);
    let foundError = false;
    
    if (tokens.length >= 3 && 
        tokens[0].type === TokenType.TK_LABEL &&
        tokens[1].type === TokenType.TK_LPAREN) {
        
        const funcName = tokens[0].value;
        const firstParam = tokens[2];
        const secondParam = tokens[4];

        if (!firstParam) return;
        
        if (validationType === 'system' && funcName === 'system') {
            if (isInvalidSystemArg(firstParam)) {
                foundError = true;
            }
            if (secondParam && isInvalidTimeoutArg(secondParam)) {
                foundError = true;
            }
        }
        
        if (validationType === 'sleep' && funcName === 'sleep') {
            if (isInvalidSleepType(firstParam)) {
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
    if (testSystemValidations(testCase.name, testCase.code, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All system function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
    process.exit(1);
}

console.log('\n💡 Note: These test the validation logic patterns for system functions.');


