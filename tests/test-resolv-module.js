// Test suite for resolv module completion and hover functionality
console.log('🔧 Running Resolv Module Tests...\n');

const { resolvTypeRegistry } = require('../src/analysis/resolvTypes');

const expectedFunctions = [
  'query', 'error'
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
console.log('🧪 Test 1: Function Registry');
expectedFunctions.forEach(funcName => {
  testResult(
    `Function '${funcName}' exists in registry`,
    resolvTypeRegistry.isResolvFunction(funcName)
  );
});

// Test 2: Function signature formatting
console.log('\n🧪 Test 2: Function Signature Formatting');
testResult(
  'query() signature formatting',
  resolvTypeRegistry.formatFunctionSignature('query') === 'query(names: string | string[], [options: object]): object'
);

testResult(
  'error() signature formatting', 
  resolvTypeRegistry.formatFunctionSignature('error') === 'error(): string | null'
);

// Test 3: Function documentation generation
console.log('\n🧪 Test 3: Function Documentation');
const queryDoc = resolvTypeRegistry.getFunctionDocumentation('query');
testResult(
  'query() documentation contains description',
  queryDoc.includes('Perform DNS queries for specified domain names')
);

testResult(
  'query() documentation contains record types',
  queryDoc.includes('**A** - IPv4 address record') && queryDoc.includes('**AAAA** - IPv6 address record')
);

testResult(
  'query() documentation contains examples',
  queryDoc.includes('```ucode') && queryDoc.includes('import { query } from \'resolv\';')
);

const errorDoc = resolvTypeRegistry.getFunctionDocumentation('error');
testResult(
  'error() documentation contains description',
  errorDoc.includes('Get the last error message from DNS operations')
);

testResult(
  'error() documentation contains example',
  errorDoc.includes('```ucode') && errorDoc.includes('import { query, error } from \'resolv\';')
);

// Test 4: Function parameter handling
console.log('\n🧪 Test 4: Function Parameter Handling');
const queryFunc = resolvTypeRegistry.getFunction('query');
testResult(
  'query() has correct parameter count',
  queryFunc && queryFunc.parameters.length === 2
);

testResult(
  'query() first parameter is required',
  queryFunc && queryFunc.parameters[0].name === 'names' && !queryFunc.parameters[0].optional
);

testResult(
  'query() second parameter is optional',
  queryFunc && queryFunc.parameters[1].name === 'options' && queryFunc.parameters[1].optional
);

const errorFunc = resolvTypeRegistry.getFunction('error');
testResult(
  'error() has no parameters',
  errorFunc && errorFunc.parameters.length === 0
);

// Test 5: Function identification
console.log('\n🧪 Test 5: Function Identification');
testResult(
  'Identifies valid resolv functions',
  resolvTypeRegistry.isResolvFunction('query') && resolvTypeRegistry.isResolvFunction('error')
);

testResult(
  'Rejects invalid function names',
  !resolvTypeRegistry.isResolvFunction('invalidFunction') && !resolvTypeRegistry.isResolvFunction('unknown')
);

// Test 6: Return type handling
console.log('\n🧪 Test 6: Return Type Validation');
testResult(
  'query() returns object',
  queryFunc && queryFunc.returnType === 'object'
);

testResult(
  'error() returns string | null',
  errorFunc && errorFunc.returnType === 'string | null'
);

// Test 7: Function name retrieval
console.log('\n🧪 Test 7: Function Name Retrieval');
const functionNames = resolvTypeRegistry.getFunctionNames();
testResult(
  'getFunctionNames() returns all functions',
  functionNames.length === expectedFunctions.length && 
  expectedFunctions.every(name => functionNames.includes(name))
);

// Test 8: Import validation
console.log('\n🧪 Test 8: Import Validation');
testResult(
  'Valid imports accepted',
  resolvTypeRegistry.isValidImport('query') && resolvTypeRegistry.isValidImport('error')
);

testResult(
  'Invalid imports rejected',
  !resolvTypeRegistry.isValidImport('invalidFunction') && !resolvTypeRegistry.isValidImport('unknown')
);

const validImports = resolvTypeRegistry.getValidImports();
testResult(
  'getValidImports() returns correct functions',
  validImports.length === 2 && validImports.includes('query') && validImports.includes('error')
);

// Test 9: Documentation formatting consistency
console.log('\n🧪 Test 9: Documentation Formatting');
testResult(
  'query() documentation has proper markdown formatting',
  queryDoc.includes('**query(') && queryDoc.includes('**Parameters:**') && queryDoc.includes('**Returns:**')
);

testResult(
  'error() documentation has proper markdown formatting',
  errorDoc.includes('**error(') && errorDoc.includes('**Returns:**')
);

// Test 10: Complex parameter documentation
console.log('\n🧪 Test 10: Complex Parameter Documentation');
testResult(
  'query() options parameter documented with sub-properties',
  queryDoc.includes('type` (string[], optional)') && 
  queryDoc.includes('nameserver` (string[], optional)') &&
  queryDoc.includes('timeout` (number, optional, default: 5000)')
);

testResult(
  'query() names parameter properly documented',
  queryDoc.includes('Domain name(s) to query') && queryDoc.includes('IP addresses can also be provided')
);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All resolv module tests passed!');
} else {
  console.log(`❌ ${totalTests - passedTests} test(s) failed`);
}