// Test rtnl module completion and union type inference
console.log('🔧 Running RTNL Module Tests...\n');

const { rtnlTypeRegistry } = require('../src/analysis/rtnlTypes');

// Test rtnl module completion registry
function testRtnlModuleCompletions() {
  console.log('🧪 Testing rtnl module function registry:');
  
  const functionNames = rtnlTypeRegistry.getFunctionNames();
  console.log(`  Available functions: [${functionNames.join(', ')}]`);
  
  const expectedFunctions = ['request', 'listener'];
  let passed = true;
  
  for (const expectedFunc of expectedFunctions) {
    if (!functionNames.includes(expectedFunc)) {
      console.log(`  ❌ FAIL: Missing function ${expectedFunc}`);
      passed = false;
    }
  }
  
  if (passed) {
    console.log('  ✅ PASS: All expected functions found');
  }
  
  return passed;
}

// Test rtnl.request() return type
function testRtnlRequestReturnType() {
  console.log('\n🧪 Testing rtnl.request() return type should be "object | null":');
  
  const requestFunction = rtnlTypeRegistry.getFunction('request');
  if (!requestFunction) {
    console.log('  ❌ FAIL: request function not found in registry');
    return false;
  }
  
  const returnType = requestFunction.returnType;
  const expectedType = 'object | null';
  
  console.log(`  Return Type: ${returnType}`);
  console.log(`  Expected Type: ${expectedType}`);
  
  const result = returnType === expectedType;
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  return result;
}

// Test rtnl.listener() return type  
function testRtnlListenerReturnType() {
  console.log('\n🧪 Testing rtnl.listener() return type:');
  
  const listenerFunction = rtnlTypeRegistry.getFunction('listener');
  if (!listenerFunction) {
    console.log('  ❌ FAIL: listener function not found in registry');
    return false;
  }
  
  const returnType = listenerFunction.returnType;
  console.log(`  Return Type: ${returnType}`);
  console.log(`  Expected to be defined: ${returnType !== undefined}`);
  
  const result = returnType !== undefined;
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  return result;
}

// Test function documentation
function testRtnlFunctionDocumentation() {
  console.log('\n🧪 Testing rtnl function documentation:');
  
  const requestDoc = rtnlTypeRegistry.getFunctionDocumentation('request');
  const hasDocumentation = requestDoc.length > 0;
  
  console.log(`  Documentation length: ${requestDoc.length} characters`);
  console.log(`  Has documentation: ${hasDocumentation}`);
  
  if (hasDocumentation) {
    console.log('  ✅ PASS: Documentation available');
  } else {
    console.log('  ❌ FAIL: No documentation found');
  }
  
  return hasDocumentation;
}

// Run the tests
let totalTests = 0;
let passedTests = 0;

if (testRtnlModuleCompletions()) passedTests++;
totalTests++;

if (testRtnlRequestReturnType()) passedTests++;
totalTests++;

if (testRtnlListenerReturnType()) passedTests++;
totalTests++;

if (testRtnlFunctionDocumentation()) passedTests++;
totalTests++;

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All RTNL module tests passed!');
  console.log('\n✨ Expected improvements:');
  console.log('  • rtnl. should now show autocomplete with request(), listener()');
  console.log('  • rtnl.request() should return "object | null" instead of "unknown"');
  console.log('  • Variable assignments: let d = rtnl.request(); should properly type d');
} else {
  console.log('❌ Some RTNL tests failed. Check module implementation.');
}