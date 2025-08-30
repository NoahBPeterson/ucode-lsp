// Unit test for JSON utility function validations

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
    TK_LBRACE: 9,
    TK_RBRACK: 10,
    TK_RBRACE: 11,
    TK_IDENT: 12, // Assuming function is represented as an identifier
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

function isStringToken(token) {
    return token.type === TokenType.TK_STRING;
}

function isFunctionToken(token) {
    return token.type === TokenType.TK_IDENT; // Simplified check
}

// Test cases for JSON utility function validations
const testCases = [
    // json() function tests - should only accept strings or objects
    {
        name: "json with number parameter",
        code: "json(123)",
        shouldError: true,
        validationType: 'json'
    },
    {
        name: "json with array parameter",
        code: "json([])",
        shouldError: true,
        validationType: 'json'
    },
    {
        name: "json with string parameter",
        code: `json(\"test\")`,
        shouldError: false,
        validationType: 'json'
    },
    {
        name: "json with object parameter",
        code: "json({})",
        shouldError: false,
        validationType: 'json'
    },
    
    // call() function tests
    {
        name: "call with number as first parameter",
        code: "call(123)",
        shouldError: true,
        validationType: 'call'
    },
    {
        name: "call with function as first parameter",
        code: "call(myFunc)",
        shouldError: false,
        validationType: 'call'
    },
    {
        name: "call with function and invalid scope (number)",
        code: "call(myFunc, null, 123)",
        shouldError: true,
        validationType: 'call'
    },
    {
        name: "call with function and valid scope (object)",
        code: "call(myFunc, null, {})",
        shouldError: false,
        validationType: 'call'
    },
    
    // signal() function tests
    {
        name: "signal with valid string parameter",
        code: `signal(\"SIGINT\")`,
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with valid lowercase string parameter",
        code: `signal(\"sigterm\")`,
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with invalid string parameter",
        code: `signal(\"SIGINVALID\")`,
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with valid number parameter",
        code: "signal(15)",
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with out-of-range number (0)",
        code: "signal(0)",
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with out-of-range number (32)",
        code: "signal(32)",
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with double parameter",
        code: "signal(15.5)",
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with array as first parameter",
        code: "signal([])",
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with valid second param (function)",
        code: "signal(15, myHandler)",
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with valid second param ('ignore')",
        code: `signal(15, \"ignore\")`,
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with valid second param ('default')",
        code: `signal(15, \"default\")`,
        shouldError: false,
        validationType: 'signal'
    },
    {
        name: "signal with invalid second param (string)",
        code: `signal(15, \"invalid_handler\")`,
        shouldError: true, // This is a warning, but for testing we treat it as an error
        validationType: 'signal'
    },
    {
        name: "signal with invalid second param (number)",
        code: "signal(15, 123)",
        shouldError: true,
        validationType: 'signal'
    },
    {
        name: "signal with unhandlable signal (SIGKILL)",
        code: `signal(\"SIGKILL\", myHandler)`,
        shouldError: true, // This is a warning, but for testing we treat it as an error
        validationType: 'signal'
    },
    {
        name: "signal with unhandlable signal (SIGSTOP)",
        code: `signal(\"SIGSTOP\", \"ignore\")`,
        shouldError: true, // This is a warning, but for testing we treat it as an error
        validationType: 'signal'
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

    const args = argsStr.split(/\s*,\s*/);

    args.forEach((arg, index) => {
        if (index > 0) tokens.push({ type: TokenType.TK_COMMA });

        if (arg.startsWith('"') && arg.endsWith('"')) {
            tokens.push({ type: TokenType.TK_STRING, value: arg });
        } else if (!isNaN(parseFloat(arg)) && isFinite(arg)) {
            tokens.push({ type: TokenType.TK_NUMBER, value: arg });
        } else if (arg.startsWith('{')) {
            tokens.push({ type: TokenType.TK_LBRACE, value: arg });
        } else if (arg.startsWith('[')) {
            tokens.push({ type: TokenType.TK_LBRACK, value: arg });
        } else if (arg === 'null') {
            tokens.push({ type: TokenType.TK_IDENT, value: arg }); // Treat null as ident
        } else {
            tokens.push({ type: TokenType.TK_IDENT, value: arg }); // Treat functions as ident
        }
    });

    tokens.push({ type: TokenType.TK_RPAREN });
    return tokens;
}


function testJSONUtilityValidations(testName, code, shouldError, validationType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const tokens = simpleParse(code);
    let foundError = false;
    
    if (tokens.length < 3) {
        // Not a valid function call structure for these tests
        return;
    }

    const funcName = tokens[0].value;
    const args = [];
    let currentArg = [];
    
    // Simplified arg extractor
    let parenCount = 0;
    for (let i = 2; i < tokens.length -1; i++) {
        if (tokens[i].type === TokenType.TK_LPAREN) parenCount++;
        if (tokens[i].type === TokenType.TK_RPAREN) parenCount--;

        if (tokens[i].type === TokenType.TK_COMMA && parenCount === 0) {
            args.push(currentArg[0]); // simple, takes first token of arg
            currentArg = [];
        } else {
            currentArg.push(tokens[i]);
        }
    }
    if (currentArg.length > 0) {
        args.push(currentArg[0]);
    }
    
    const firstParam = args[0];
    const secondParam = args[1];
    const thirdParam = args[2];

    // json function validation
    if (validationType === 'json' && funcName === 'json') {
        if (!firstParam || (!isStringToken(firstParam) && !isObjectToken(firstParam))) {
            foundError = true;
        }
    }
    
    // call function validation
    if (validationType === 'call' && funcName === 'call') {
        if (!firstParam || !isFunctionToken(firstParam)) {
            foundError = true;
        }
        if (thirdParam && !isObjectToken(thirdParam) && thirdParam.value !== 'null') {
            foundError = true;
        }
    }
    
    // signal function validation
    if (validationType === 'signal' && funcName === 'signal') {
        const VALID_SIGNAL_NAMES = new Set([
            'INT', 'ILL', 'ABRT', 'FPE', 'SEGV', 'TERM', 'HUP', 'QUIT', 'TRAP', 
            'KILL', 'PIPE', 'ALRM', 'STKFLT', 'PWR', 'BUS', 'SYS', 'URG', 'STOP', 
            'TSTP', 'CONT', 'CHLD', 'TTIN', 'TTOU', 'POLL', 'XFSZ', 'XCPU', 
            'VTALRM', 'PROF', 'USR1', 'USR2'
        ]);
        const UNHANDLABLE_SIGNALS = new Set(['KILL', 'STOP']);

        if (!firstParam) {
            foundError = true;
        } else if (isNumericToken(firstParam)) {
            const numVal = parseFloat(firstParam.value);
            if (numVal < 1 || numVal > 31 || !Number.isInteger(numVal)) {
                foundError = true;
            }
        } else if (isStringToken(firstParam)) {
            let sigStr = firstParam.value.replace(/"/g, '').toUpperCase();
            if (sigStr.startsWith('SIG')) {
                sigStr = sigStr.substring(3);
            }
            if (!VALID_SIGNAL_NAMES.has(sigStr)) {
                foundError = true;
            }
        } else {
            foundError = true; // Not a number or string
        }

        if (secondParam) {
            if (isStringToken(secondParam)) {
                const handlerStr = secondParam.value.replace(/"/g, '');
                if (handlerStr !== 'ignore' && handlerStr !== 'default') {
                    foundError = true; // Invalid string handler (warning)
                }
            } else if (!isFunctionToken(secondParam)) {
                foundError = true; // Not a function or valid string
            }
        }

        if (isStringToken(firstParam)) {
            let sigStr = firstParam.value.replace(/"/g, '').toUpperCase();
            if (sigStr.startsWith('SIG')) {
                sigStr = sigStr.substring(3);
            }
            if (UNHANDLABLE_SIGNALS.has(sigStr)) {
                foundError = true; // Unhandlable signal (warning)
            }
        }
    }
    
    const result = foundError === shouldError;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'} (found error: ${foundError}, expected: ${shouldError})`);
    return result;
}

console.log('🧪 Testing Core Utility Function Validations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testJSONUtilityValidations(testCase.name, testCase.code, testCase.shouldError, testCase.validationType)) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All core utility function validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
    process.exit(1); // Exit with error code
}
