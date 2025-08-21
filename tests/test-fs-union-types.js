// Test union type inference for imported fs functions
console.log('🔧 Running FS Union Type Tests...\n');

const { fsModuleTypeRegistry } = require('../src/analysis/fsModuleTypes');

// Test that chmod returns the correct union type
function testChmodUnionType() {
  console.log('🧪 Testing chmod() return type should be "boolean | null":');
  
  const chmodFunction = fsModuleTypeRegistry.getFunction('chmod');
  if (!chmodFunction) {
    console.log('  ❌ FAIL: chmod function not found in registry');
    return false;
  }
  
  const returnType = chmodFunction.returnType;
  const expectedType = 'boolean | null';
  
  console.log(`  Return Type: ${returnType}`);
  console.log(`  Expected Type: ${expectedType}`);
  
  const result = returnType === expectedType;
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  return result;
}

// Test a few other functions that should have union types
function testFsUnionTypes() {
  const testCases = [
    { name: 'chmod', expected: 'boolean | null' },
    { name: 'chown', expected: 'boolean | null' },  // Assuming this also got fixed
    { name: 'mkdir', expected: 'boolean' },        // This one should still be just boolean
    { name: 'stat', expected: 'object | null' },   // This one should be object | null
  ];
  
  let passed = 0;
  let total = 0;
  
  for (const testCase of testCases) {
    total++;
    console.log(`\n🧪 Testing ${testCase.name}() return type should be "${testCase.expected}":`);
    
    const func = fsModuleTypeRegistry.getFunction(testCase.name);
    if (!func) {
      console.log(`  ❌ FAIL: ${testCase.name} function not found in registry`);
      continue;
    }
    
    const returnType = func.returnType;
    console.log(`  Return Type: ${returnType}`);
    console.log(`  Expected Type: ${testCase.expected}`);
    
    const result = returnType === testCase.expected;
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    if (result) passed++;
  }
  
  return { passed, total };
}

// Run the tests
let totalTests = 0;
let passedTests = 0;

// Test individual chmod function
if (testChmodUnionType()) {
  passedTests++;
}
totalTests++;

// Test multiple fs functions
const multiResults = testFsUnionTypes();
passedTests += multiResults.passed;
totalTests += multiResults.total;

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All fs union type tests passed!');
} else {
  console.log('❌ Some tests failed. Union type definitions may need updating.');
}