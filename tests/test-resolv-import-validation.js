// Test resolv module import validation
console.log('🧪 Testing Resolv Module Import Validation...\n');

const { resolvTypeRegistry } = require('../src/analysis/resolvTypes');

let totalTests = 0;
let passedTests = 0;

function testResult(testName, condition, details = '') {
  totalTests++;
  console.log(`🧪 Testing ${testName}:`);
  if (condition) {
    console.log(`  Result: ✅ PASS ${details}`);
    passedTests++;
    return true;
  } else {
    console.log(`  Result: ❌ FAIL ${details}`);
    return false;
  }
}

// Test 1: Valid function imports
const validFunctions = ['query', 'error'];
const allValidFunctions = validFunctions.every(func => resolvTypeRegistry.isValidImport(func));
testResult('Valid function imports', allValidFunctions, 
  `Functions checked: ${validFunctions.join(', ')}`);

// Test 2: Invalid function imports should be rejected
const invalidFunctions = ['invalidFunction', 'query2', 'ERROR', 'Query'];
const allInvalidFunctions = invalidFunctions.every(func => !resolvTypeRegistry.isValidImport(func));
testResult('Invalid function imports rejected', allInvalidFunctions,
  `Invalid functions checked: ${invalidFunctions.join(', ')}`);

// Test 3: Case sensitivity
testResult('Case sensitivity - query is valid', resolvTypeRegistry.isValidImport('query'));
testResult('Case sensitivity - Query is invalid', !resolvTypeRegistry.isValidImport('Query'));
testResult('Case sensitivity - error is valid', resolvTypeRegistry.isValidImport('error'));
testResult('Case sensitivity - ERROR is invalid', !resolvTypeRegistry.isValidImport('ERROR'));

// Test 4: Get valid imports function
const validImports = resolvTypeRegistry.getValidImports();
testResult('getValidImports returns array', Array.isArray(validImports));
testResult('getValidImports contains query', validImports.includes('query'));
testResult('getValidImports contains error', validImports.includes('error'));
testResult('getValidImports has correct length', validImports.length === 2);

// Test 5: Boundary conditions
testResult('Empty string is invalid', !resolvTypeRegistry.isValidImport(''));
testResult('Null is invalid', !resolvTypeRegistry.isValidImport(null));
testResult('Undefined is invalid', !resolvTypeRegistry.isValidImport(undefined));

// Test 6: Test function identification
testResult('isResolvFunction works for query', resolvTypeRegistry.isResolvFunction('query'));
testResult('isResolvFunction works for error', resolvTypeRegistry.isResolvFunction('error'));
testResult('isResolvFunction rejects invalid', !resolvTypeRegistry.isResolvFunction('invalid'));

// Test 7: Verify registry consistency
const registryFunctions = resolvTypeRegistry.getFunctionNames();
testResult('Function names match valid imports', 
  registryFunctions.length === validImports.length &&
  registryFunctions.every(name => validImports.includes(name))
);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All resolv import validation tests passed!');
} else {
  console.log(`❌ ${totalTests - passedTests} test(s) failed`);
}