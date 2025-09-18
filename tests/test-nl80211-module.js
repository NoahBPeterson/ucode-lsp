// Test suite for nl80211 module completion and hover functionality
console.log('🔧 Running NL80211 Module Tests...\n');

const { nl80211TypeRegistry } = require('../src/analysis/nl80211Types');

const expectedFunctions = [
  'error', 'request', 'waitfor', 'listener'
];

const expectedConstants = [
  'NLM_F_ACK', 'NLM_F_DUMP', 'NL80211_CMD_GET_WIPHY', 'NL80211_CMD_GET_INTERFACE',
  'NL80211_CMD_TRIGGER_SCAN', 'NL80211_CMD_CONNECT', 'NL80211_IFTYPE_STATION',
  'NL80211_IFTYPE_AP', 'HWSIM_CMD_REGISTER', 'HWSIM_CMD_NEW_RADIO'
];

let totalTests = 0;
let passedTests = 0;

function testNl80211Validation(testName, testFunction) {
    console.log(`\n🧪 Testing ${testName}:`);
    totalTests++;
    try {
        const result = testFunction();
        console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
        if (result) {
            passedTests++;
        }
        return result;
    } catch (error) {
        console.log(`  Result: ❌ FAIL (Error: ${error.message})`);
        return false;
    }
}

// Test 1: All expected functions are present
testNl80211Validation('All expected functions are present', () => {
    const functionNames = nl80211TypeRegistry.getFunctionNames();
    console.log(`  Functions found: ${functionNames.length}`);
    console.log(`  Expected: ${expectedFunctions.length}`);
    
    for (const funcName of expectedFunctions) {
        if (!functionNames.includes(funcName)) {
            console.log(`  Missing function: ${funcName}`);
            return false;
        }
    }
    return functionNames.length === expectedFunctions.length;
});

// Test 2: All expected constants are present
testNl80211Validation('All expected constants are present', () => {
    const constantNames = nl80211TypeRegistry.getConstantNames();
    console.log(`  Constants found: ${constantNames.length}`);
    console.log(`  Expected sample: ${expectedConstants.length}`);
    
    for (const constName of expectedConstants) {
        if (!constantNames.includes(constName)) {
            console.log(`  Missing constant: ${constName}`);
            return false;
        }
    }
    return constantNames.length >= expectedConstants.length;
});

// Test 3: Function signature formatting
testNl80211Validation('Function signature formatting', () => {
    const signature = nl80211TypeRegistry.formatFunctionSignature('request');
    console.log(`  Signature: ${signature}`);
    const expected = 'request(cmd: integer, [flags: integer], [payload: object]): object | null';
    return signature === expected;
});

// Test 4: Function documentation generation
testNl80211Validation('Function documentation generation', () => {
    const doc = nl80211TypeRegistry.getFunctionDocumentation('error');
    console.log(`  Doc length: ${doc.length} characters`);
    return doc.includes('**error(): string | null**') && 
           doc.includes('Returns the last nl80211 error') &&
           doc.includes('**Returns:** `string | null`');
});

// Test 5: Function parameter handling
testNl80211Validation('Function parameter handling', () => {
    const waitforFunc = nl80211TypeRegistry.getFunction('waitfor');
    console.log(`  waitfor parameters: ${waitforFunc.parameters.length}`);
    return waitforFunc.parameters.length === 2 &&
           waitforFunc.parameters[0].name === 'cmds' &&
           waitforFunc.parameters[0].optional === false &&
           waitforFunc.parameters[1].name === 'timeout' &&
           waitforFunc.parameters[1].optional === true;
});

// Test 6: Function identification
testNl80211Validation('Function identification', () => {
    const isFunction = nl80211TypeRegistry.isNl80211Function('listener');
    const isNotFunction = nl80211TypeRegistry.isNl80211Function('nonexistent');
    console.log(`  listener is function: ${isFunction}`);
    console.log(`  nonexistent is function: ${isNotFunction}`);
    return isFunction === true && isNotFunction === false;
});

// Test 7: Constant identification
testNl80211Validation('Constant identification', () => {
    const isConstant = nl80211TypeRegistry.isNl80211Constant('NLM_F_ACK');
    const isNotConstant = nl80211TypeRegistry.isNl80211Constant('nonexistent');
    console.log(`  NLM_F_ACK is constant: ${isConstant}`);
    console.log(`  nonexistent is constant: ${isNotConstant}`);
    return isConstant === true && isNotConstant === false;
});

// Test 8: Return type handling
testNl80211Validation('Return type handling', () => {
    const listenerFunc = nl80211TypeRegistry.getFunction('listener');
    console.log(`  listener return type: ${listenerFunc.returnType}`);
    return listenerFunc.returnType === 'nl80211.listener';
});

// Test 10: Import validation
testNl80211Validation('Import validation', () => {
    const validImports = nl80211TypeRegistry.getValidImports();
    const isRequestValid = nl80211TypeRegistry.isValidImport('request');
    const isConstantValid = nl80211TypeRegistry.isValidImport('NLM_F_ACK');
    const isInvalidValid = nl80211TypeRegistry.isValidImport('nonexistent');
    
    console.log(`  Valid imports count: ${validImports.length}`);
    console.log(`  'request' is valid: ${isRequestValid}`);
    console.log(`  'NLM_F_ACK' is valid: ${isConstantValid}`);
    console.log(`  'nonexistent' is valid: ${isInvalidValid}`);
    
    return validImports.length > 0 && 
           isRequestValid === true && 
           isConstantValid === true && 
           isInvalidValid === false;
});

// Test 11: Complex function signatures
testNl80211Validation('Complex function signatures', () => {
    const requestFunc = nl80211TypeRegistry.getFunction('request');
    const hasOptionalParams = requestFunc.parameters.some(p => p.optional);
    const hasRequiredParams = requestFunc.parameters.some(p => !p.optional);
    
    console.log(`  Has optional params: ${hasOptionalParams}`);
    console.log(`  Has required params: ${hasRequiredParams}`);
    
    return hasOptionalParams && hasRequiredParams;
});

// Test 12: Documentation formatting
testNl80211Validation('Documentation formatting', () => {
    const doc = nl80211TypeRegistry.getFunctionDocumentation('waitfor');
    
    const hasSignature = doc.includes('**waitfor(');
    const hasDescription = doc.includes('Waits for specific nl80211 commands');
    const hasParameters = doc.includes('**Parameters:**');
    const hasReturns = doc.includes('**Returns:**');
    const hasExample = doc.includes('**Example:**');
    
    console.log(`  Has signature: ${hasSignature}`);
    console.log(`  Has description: ${hasDescription}`);
    console.log(`  Has parameters: ${hasParameters}`);
    console.log(`  Has returns: ${hasReturns}`);
    console.log(`  Has example: ${hasExample}`);
    
    return hasSignature && hasDescription && hasParameters && hasReturns && hasExample;
});

// Test 13: Mock completion integration test
testNl80211Validation('Mock completion integration', () => {
    // Simulate completion request for nl80211 module
    const functionNames = nl80211TypeRegistry.getFunctionNames();
    const constantNames = nl80211TypeRegistry.getConstantNames();
    
    // Mock completion items
    const mockCompletionItems = [];
    
    // Add function completions
    for (const funcName of functionNames) {
        const func = nl80211TypeRegistry.getFunction(funcName);
        if (func) {
            mockCompletionItems.push({
                label: funcName,
                kind: 'Function',
                detail: 'nl80211 module function',
                documentation: nl80211TypeRegistry.getFunctionDocumentation(funcName)
            });
        }
    }
    
    // Add constant completions
    for (const constName of constantNames) {
        const constant = nl80211TypeRegistry.getConstant(constName);
        if (constant) {
            mockCompletionItems.push({
                label: constName,
                kind: 'Constant',
                detail: 'nl80211 module constant',
                documentation: nl80211TypeRegistry.getConstantDocumentation(constName)
            });
        }
    }
    
    console.log(`  Mock completion items generated: ${mockCompletionItems.length}`);
    
    return mockCompletionItems.length === (functionNames.length + constantNames.length) &&
           mockCompletionItems.every(item => item.label && item.kind && item.detail);
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All NL80211 module tests passed!');
} else {
    console.log('❌ Some tests failed. Please check the implementation.');
    process.exit(1);
}