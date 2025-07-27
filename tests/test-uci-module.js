// Test suite for UCI module completion and hover functionality
console.log('🔧 Running UCI Module Tests...\n');

const { uciTypeRegistry } = require('../src/analysis/uciTypes');

const expectedFunctions = [
  'error', 'cursor'
];

const expectedCursorMethods = [
  'load', 'unload', 'get', 'get_all', 'get_first', 'add', 'set', 'delete',
  'list_append', 'list_remove', 'rename', 'reorder', 'save', 'commit',
  'revert', 'changes', 'foreach', 'configs', 'error'
];

let totalTests = 0;
let passedTests = 0;

function testResult(testName, condition, details = '') {
    totalTests++;
    const status = condition ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${testName}${details ? ' - ' + details : ''}`);
    if (condition) passedTests++;
    return condition;
}

// Test 1: All expected functions are present
console.log('🧪 Test 1: Function Registry Completeness');
expectedFunctions.forEach(funcName => {
    const hasFunction = uciTypeRegistry.isUciFunction(funcName);
    testResult(`Function '${funcName}' exists`, hasFunction);
});

// Test 2: All expected cursor methods are present
console.log('\n🧪 Test 2: Cursor Methods Registry Completeness');
expectedCursorMethods.forEach(methodName => {
    const hasMethod = uciTypeRegistry.isUciCursorMethod(methodName);
    testResult(`Cursor method '${methodName}' exists`, hasMethod);
});

// Test 3: Function signature formatting
console.log('\n🧪 Test 3: Function Signature Formatting');
expectedFunctions.forEach(funcName => {
    const signature = uciTypeRegistry.formatFunctionSignature(funcName);
    const hasSignature = signature && signature.includes(funcName);
    testResult(`Function '${funcName}' has valid signature`, hasSignature, signature ? `(${signature})` : '');
});

// Test 4: Cursor method signature formatting
console.log('\n🧪 Test 4: Cursor Method Signature Formatting');
expectedCursorMethods.forEach(methodName => {
    const signature = uciTypeRegistry.formatCursorMethodSignature(methodName);
    const hasSignature = signature && signature.includes(methodName);
    testResult(`Cursor method '${methodName}' has valid signature`, hasSignature, signature ? `(${signature})` : '');
});

// Test 5: Function documentation generation
console.log('\n🧪 Test 5: Function Documentation Generation');
expectedFunctions.forEach(funcName => {
    const doc = uciTypeRegistry.getFunctionDocumentation(funcName);
    const hasDoc = doc && doc.includes('**') && doc.includes('Returns:');
    testResult(`Function '${funcName}' has documentation`, hasDoc);
});

// Test 6: Cursor method documentation generation
console.log('\n🧪 Test 6: Cursor Method Documentation Generation');
expectedCursorMethods.forEach(methodName => {
    const doc = uciTypeRegistry.getCursorMethodDocumentation(methodName);
    const hasDoc = doc && doc.includes('**') && doc.includes('Returns:');
    testResult(`Cursor method '${methodName}' has documentation`, hasDoc);
});

// Test 7: Function parameter handling
console.log('\n🧪 Test 7: Function Parameter Handling');
const cursorFunc = uciTypeRegistry.getFunction('cursor');
if (cursorFunc) {
    testResult('cursor() has optional parameters', cursorFunc.parameters.some(p => p.optional));
    testResult('cursor() has default values', cursorFunc.parameters.some(p => p.defaultValue !== undefined));
} else {
    testResult('cursor() function exists', false);
}

// Test 8: Cursor method parameter handling
console.log('\n🧪 Test 8: Cursor Method Parameter Handling');
const getMethod = uciTypeRegistry.getCursorMethod('get');
if (getMethod) {
    testResult('get() has required parameters', getMethod.parameters.some(p => !p.optional));
    testResult('get() has optional parameters', getMethod.parameters.some(p => p.optional));
} else {
    testResult('get() method exists', false);
}

// Test 9: Function identification
console.log('\n🧪 Test 9: Function Identification');
testResult('cursor is identified as UCI function', uciTypeRegistry.isUciFunction('cursor'));
testResult('invalid_function is not identified as UCI function', !uciTypeRegistry.isUciFunction('invalid_function'));
testResult('load is identified as UCI cursor method', uciTypeRegistry.isUciCursorMethod('load'));
testResult('invalid_method is not identified as UCI cursor method', !uciTypeRegistry.isUciCursorMethod('invalid_method'));

// Test 10: Return type handling
console.log('\n🧪 Test 10: Return Type Handling');
const errorFunc = uciTypeRegistry.getFunction('error');
testResult('error() has null union return type', errorFunc && errorFunc.returnType.includes('null'));

const loadMethod = uciTypeRegistry.getCursorMethod('load');
testResult('load() has boolean return type', loadMethod && loadMethod.returnType.includes('boolean'));

// Test 11: Complex parameter types
console.log('\n🧪 Test 11: Complex Parameter Types');
const setMethod = uciTypeRegistry.getCursorMethod('set');
testResult('set() has complex value parameter type', setMethod && setMethod.parameters.some(p => 
    p.type.includes('|') || p.type.includes('[]')
));

// Test 12: Import validation
console.log('\n🧪 Test 12: Import Validation');
testResult('cursor is valid import', uciTypeRegistry.isValidImport('cursor'));
testResult('error is valid import', uciTypeRegistry.isValidImport('error'));
testResult('invalid_import is not valid import', !uciTypeRegistry.isValidImport('invalid_import'));

const validImports = uciTypeRegistry.getValidImports();
testResult('getValidImports returns non-empty array', validImports.length > 0);
testResult('getValidImports includes cursor', validImports.includes('cursor'));

// Test 13: Function list consistency
console.log('\n🧪 Test 13: Function List Consistency');
const functionNames = uciTypeRegistry.getFunctionNames();
testResult('getFunctionNames returns expected count', functionNames.length === expectedFunctions.length);

const cursorMethodNames = uciTypeRegistry.getCursorMethodNames();
testResult('getCursorMethodNames returns expected count', cursorMethodNames.length === expectedCursorMethods.length);

// Test 14: Edge cases
console.log('\n🧪 Test 14: Edge Cases');
testResult('Empty string is not valid function', !uciTypeRegistry.isUciFunction(''));
testResult('Empty string is not valid cursor method', !uciTypeRegistry.isUciCursorMethod(''));
testResult('Undefined function returns empty documentation', uciTypeRegistry.getFunctionDocumentation('nonexistent') === '');
testResult('Undefined cursor method returns empty documentation', uciTypeRegistry.getCursorMethodDocumentation('nonexistent') === '');

// Test 15: Mock completion integration test
console.log('\n🧪 Test 15: Mock Completion Integration');
function mockGetUciModuleCompletions() {
    const functionNames = uciTypeRegistry.getFunctionNames();
    const completions = [];
    
    for (const functionName of functionNames) {
        const signature = uciTypeRegistry.getFunction(functionName);
        if (signature) {
            completions.push({
                label: functionName,
                kind: 'Function',
                detail: 'UCI module function',
                documentation: uciTypeRegistry.getFunctionDocumentation(functionName)
            });
        }
    }
    
    return completions;
}

const completions = mockGetUciModuleCompletions();
testResult('Mock completion generates items', completions.length > 0);
testResult('Mock completion includes cursor', completions.some(c => c.label === 'cursor'));
testResult('Mock completion includes documentation', completions.every(c => c.documentation));

// Test 16: Mock cursor method completion
console.log('\n🧪 Test 16: Mock Cursor Method Completion');
function mockGetUciCursorMethodCompletions() {
    const methodNames = uciTypeRegistry.getCursorMethodNames();
    const completions = [];
    
    for (const methodName of methodNames) {
        const signature = uciTypeRegistry.getCursorMethod(methodName);
        if (signature) {
            completions.push({
                label: methodName,
                kind: 'Method',
                detail: 'UCI cursor method',
                documentation: uciTypeRegistry.getCursorMethodDocumentation(methodName)
            });
        }
    }
    
    return completions;
}

const cursorCompletions = mockGetUciCursorMethodCompletions();
testResult('Mock cursor completion generates items', cursorCompletions.length > 0);
testResult('Mock cursor completion includes get', cursorCompletions.some(c => c.label === 'get'));
testResult('Mock cursor completion includes load', cursorCompletions.some(c => c.label === 'load'));
testResult('Mock cursor completion includes commit', cursorCompletions.some(c => c.label === 'commit'));

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All UCI module tests passed!');
} else {
    console.log(`⚠️  ${totalTests - passedTests} test(s) failed.`);
    process.exit(1);
}