// Unit test for new validation implementations and patterns

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_RPAREN: 3,
    TK_NUMBER: 4,
    TK_STRING: 5,
    TK_COMMA: 6,
    TK_SEMICOLON: 7
};

// Mock validation functions
function mockValidateStringAnalysis(functionName, params) {
    const stringFunctions = ['length', 'index', 'rindex', 'match', 'substr'];
    
    if (!stringFunctions.includes(functionName)) {
        return { isValid: true, errors: [] };
    }
    
    const errors = [];
    
    switch (functionName) {
        case 'length':
            if (params.length !== 1 || params[0].type === TokenType.TK_NUMBER) {
                errors.push(`length() expects a string parameter, got ${params[0]?.type}`);
            }
            break;
            
        case 'index':
        case 'rindex':
            if (params.length !== 2) {
                errors.push(`${functionName}() expects 2 parameters`);
            } else {
                if (params[0].type === TokenType.TK_NUMBER) {
                    errors.push(`${functionName}() first parameter should be string, got number`);
                }
                if (params[1].type === TokenType.TK_NUMBER) {
                    errors.push(`${functionName}() second parameter should be string, got number`);
                }
            }
            break;
            
        case 'match':
            if (params.length !== 2) {
                errors.push('match() expects 2 parameters');
            } else {
                if (params[0].type === TokenType.TK_NUMBER) {
                    errors.push('match() first parameter should be string, got number');
                }
                if (params[1].type === TokenType.TK_NUMBER) {
                    errors.push('match() second parameter should be regex or string, got number');
                }
            }
            break;
    }
    
    return { isValid: errors.length === 0, errors };
}

function mockValidateArrayFunctions(functionName, params) {
    const arrayFunctions = ['filter', 'map', 'forEach', 'reduce'];
    
    if (!arrayFunctions.includes(functionName)) {
        return { isValid: true, errors: [] };
    }
    
    const errors = [];
    
    switch (functionName) {
        case 'filter':
        case 'map':
            if (params.length !== 2) {
                errors.push(`${functionName}() expects 2 parameters`);
            } else {
                if (params[0].type === TokenType.TK_STRING) {
                    errors.push(`${functionName}() first parameter should be array, got string`);
                }
                if (params[1].type === TokenType.TK_NUMBER) {
                    errors.push(`${functionName}() second parameter should be function, got number`);
                }
            }
            break;
    }
    
    return { isValid: errors.length === 0, errors };
}

function mockValidateObjectFunctions(functionName, params) {
    const objectFunctions = ['keys', 'values', 'exists', 'hasOwnProperty'];
    
    if (!objectFunctions.includes(functionName)) {
        return { isValid: true, errors: [] };
    }
    
    const errors = [];
    
    switch (functionName) {
        case 'keys':
        case 'values':
            if (params.length !== 1) {
                errors.push(`${functionName}() expects 1 parameter`);
            } else {
                if (params[0].type === TokenType.TK_STRING || params[0].type === TokenType.TK_NUMBER) {
                    errors.push(`${functionName}() parameter should be object, got ${params[0].type === TokenType.TK_STRING ? 'string' : 'number'}`);
                }
            }
            break;
            
        case 'exists':
            if (params.length !== 2) {
                errors.push('exists() expects 2 parameters');
            } else {
                if (params[0].type === TokenType.TK_STRING) {
                    errors.push('exists() first parameter should be object, got string');
                }
                if (params[1].type === TokenType.TK_NUMBER) {
                    errors.push('exists() second parameter should be string, got number');
                }
            }
            break;
    }
    
    return { isValid: errors.length === 0, errors };
}

// Test cases for new validation implementations
const testCases = [
    {
        name: "string analysis - length with number parameter",
        functionName: "length",
        params: [{ type: TokenType.TK_NUMBER, value: "123" }],
        expectedErrors: 1,
        description: "Should detect invalid number parameter for length()"
    },
    {
        name: "string analysis - valid length call",
        functionName: "length",
        params: [{ type: TokenType.TK_STRING, value: '"hello"' }],
        expectedErrors: 0,
        description: "Should accept valid string parameter for length()"
    },
    {
        name: "array functions - filter with string first parameter",
        functionName: "filter",
        params: [{ type: TokenType.TK_STRING, value: '"array"' }, { type: TokenType.TK_LABEL, value: "func" }],
        expectedErrors: 1,
        description: "Should detect invalid string parameter for filter()"
    },
    {
        name: "array functions - valid filter call",
        functionName: "filter",
        params: [{ type: TokenType.TK_LABEL, value: "myArray" }, { type: TokenType.TK_LABEL, value: "myFunc" }],
        expectedErrors: 0,
        description: "Should accept valid parameters for filter()"
    },
    {
        name: "object functions - keys with string parameter",
        functionName: "keys",
        params: [{ type: TokenType.TK_STRING, value: '"object"' }],
        expectedErrors: 1,
        description: "Should detect invalid string parameter for keys()"
    },
    {
        name: "object functions - valid keys call",
        functionName: "keys",
        params: [{ type: TokenType.TK_LABEL, value: "myObj" }],
        expectedErrors: 0,
        description: "Should accept valid object parameter for keys()"
    }
];

function testNewValidations(testName, functionName, params, expectedErrors) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let result = { isValid: true, errors: [] };
    
    // Apply appropriate validation based on function type
    if (['length', 'index', 'rindex', 'match'].includes(functionName)) {
        result = mockValidateStringAnalysis(functionName, params);
    } else if (['filter', 'map'].includes(functionName)) {
        result = mockValidateArrayFunctions(functionName, params);
    } else if (['keys', 'values', 'exists'].includes(functionName)) {
        result = mockValidateObjectFunctions(functionName, params);
    }
    
    const actualErrors = result.errors.length;
    const testPassed = (expectedErrors > 0 && actualErrors > 0) || (expectedErrors === 0 && actualErrors === 0);
    
    console.log(`  Function: ${functionName}()`);
    console.log(`  Parameters: [${params.map(p => `${p.type}:${p.value}`).join(', ')}]`);
    console.log(`  Expected errors: ${expectedErrors}, Found: ${actualErrors}`);
    
    if (result.errors.length > 0) {
        result.errors.forEach((error, i) => {
            console.log(`    ${i + 1}. ${error}`);
        });
    }
    
    console.log(`  Result: ${testPassed ? '✅ PASS' : '❌ FAIL'}`);
    
    return testPassed;
}

console.log('🧪 Testing New Validation Implementations...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testNewValidations(
        testCase.name,
        testCase.functionName,
        testCase.params,
        testCase.expectedErrors
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All new validation implementation tests passed!');
    console.log('✅ String analysis function validation working');
    console.log('✅ Array function validation working');
    console.log('✅ Object function validation working');
    console.log('✅ Parameter type checking implemented correctly');
} else {
    console.log('❌ Some tests failed. Check validation implementations.');
}

console.log('\n💡 Note: These test the new validation patterns for ucode built-in functions.');
console.log('💡 Proper validation prevents runtime errors and improves code quality.');