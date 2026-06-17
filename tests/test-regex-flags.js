// Test suite for regex flag parsing validation
console.log('🔧 Running Regex Flags Tests...\n');

const { UcodeLexer } = require('../src/lexer/ucodeLexer');
const { TokenType } = require('../src/lexer/tokenTypes');

const testCases = [
    {
        name: "Regex with 's' flag (multiline mode)",
        code: `/^-- Expect (stdout|stderr|exitcode) --$/s`,
        shouldError: false,
        expectedFlags: 's'
    },
    {
        name: "Regex with 'i' flag (case insensitive)",
        code: `/hello world/i`,
        shouldError: false,
        expectedFlags: 'i'
    },
    {
        name: "Regex with both 'i' and 's' flags",
        code: `/test.*pattern/is`,
        shouldError: false,
        expectedFlags: 'is'
    },
    {
        name: "Regex with both 's' and 'i' flags (different order)",
        code: `/test.*pattern/si`,
        shouldError: false,
        expectedFlags: 'si'
    },
    {
        name: "Regex with 'g' flag (global mode)",
        code: `/test.*pattern/g`,
        shouldError: false,
        expectedFlags: 'g'
    },
    {
        name: "Regex with all supported flags 'gis'",
        code: `/test.*pattern/gis`,
        shouldError: false,
        expectedFlags: 'gis'
    },
    {
        name: "Basic regex without flags",
        code: `/simple.*pattern/`,
        shouldError: false,
        expectedFlags: ''
    },
    {
        name: "Regex with unsupported 'm' flag should show error",
        code: `/test.*pattern/m`,
        shouldError: true,
        expectedError: "Unsupported regex flag 'm'. Supported flags are: g, i, s"
    },
    {
        name: "Regex with unsupported 'u' flag should show error",
        code: `/test.*pattern/u`,
        shouldError: true,
        expectedError: "Unsupported regex flag 'u'. Supported flags are: g, i, s"
    },
    {
        name: "Regex with mix of supported and unsupported flags should error on first unsupported",
        code: `/test.*pattern/imu`,
        shouldError: true,
        expectedError: "Unsupported regex flag 'm'. Supported flags are: g, i, s"
    }
];

function testRegexFlagParsing(testName, code, shouldError, expectedFlags, expectsTrailing, expectedError) {
    console.log(`\n🧪 Testing ${testName}:`);
    console.log(`  Code: ${code}`);
    
    try {
        const lexer = new UcodeLexer(code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Check for error cases first. #56: an unsupported flag is reported via the lexer's
        // side-channel (lexer.errors), NOT a TK_ERROR token — the regex token must still be
        // emitted so the enclosing call's argument list stays intact.
        if (shouldError) {
            const lexErr = lexer.errors.find(e => e.message === expectedError) || lexer.errors[0];
            if (lexErr) {
                console.log(`  Lexer error: ${lexErr.message}`);
                // The regex token must STILL be present (the argument survives).
                const stillHasRegex = tokens.some(t => t.type === TokenType.TK_REGEXP);
                if (expectedError && lexErr.message === expectedError && stillHasRegex) {
                    console.log(`  Result: ✅ PASS - Expected error occurred AND regex token preserved`);
                    return true;
                } else {
                    console.log(`  Expected error: ${expectedError}; regex preserved: ${stillHasRegex}`);
                    console.log(`  Result: ❌ FAIL - Wrong error message or regex token dropped`);
                    return false;
                }
            } else {
                console.log(`  Result: ❌ FAIL - Expected lexer error but found none`);
                return false;
            }
        }
        
        // Find the regex token for non-error cases
        const regexToken = tokens.find(token => token.type === TokenType.TK_REGEXP);
        
        if (!regexToken) {
            console.log(`  Result: ❌ FAIL - No regex token found`);
            return false;
        }
        
        console.log(`  Regex token value: ${regexToken.value}`);
        
        // Extract flags from the token value
        const flagMatch = regexToken.value.match(/\/(.*)\/([gis]*)$/);
        if (!flagMatch) {
            console.log(`  Result: ❌ FAIL - Could not parse regex token value`);
            return false;
        }
        
        const actualFlags = flagMatch[2] || '';
        console.log(`  Expected flags: '${expectedFlags}'`);
        console.log(`  Actual flags: '${actualFlags}'`);
        
        if (actualFlags !== expectedFlags) {
            console.log(`  Result: ❌ FAIL - Flag mismatch`);
            return false;
        }
        
        // Check for trailing characters that should be separate tokens
        if (expectsTrailing) {
            const nextToken = tokens[tokens.indexOf(regexToken) + 1];
            if (!nextToken || nextToken.type === TokenType.TK_EOF) {
                console.log(`  Result: ❌ FAIL - Expected trailing character as separate token`);
                return false;
            }
            console.log(`  Next token: ${nextToken.type} = '${nextToken.value}'`);
        }
        
        console.log(`  Result: ✅ PASS`);
        return true;
    } catch (error) {
        console.log(`  Result: ❌ FAIL - Unexpected exception: ${error.message}`);
        return false;
    }
}

// Run all tests
let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testRegexFlagParsing(
        testCase.name, 
        testCase.code, 
        testCase.shouldError, 
        testCase.expectedFlags,
        testCase.expectsTrailingM || testCase.expectsTrailingU || testCase.expectsTrailingMU,
        testCase.expectedError
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All regex flag tests passed!');
} else {
    console.log('❌ Some tests failed. Check the output above for details.');
    process.exit(1);
}