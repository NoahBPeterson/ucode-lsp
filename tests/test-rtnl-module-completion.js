// Unit test for RTNL module completion functionality
// This test ensures rtnl. autocomplete works and prevents regressions

console.log('🔧 Running RTNL Module Completion Tests...\n');

const { rtnlTypeRegistry } = require('../src/analysis/rtnlTypes');

// Test 1: Registry has required functions
function testRtnlRegistryFunctions() {
  console.log('🧪 Testing RTNL registry functions:');
  
  const functionNames = rtnlTypeRegistry.getFunctionNames();
  const expectedFunctions = ['request', 'listener', 'error'];
  
  console.log(`  Available functions: [${functionNames.join(', ')}]`);
  console.log(`  Expected functions: [${expectedFunctions.join(', ')}]`);
  
  let allFound = true;
  for (const expectedFunc of expectedFunctions) {
    if (!functionNames.includes(expectedFunc)) {
      console.log(`  ❌ Missing: ${expectedFunc}`);
      allFound = false;
    }
  }
  
  if (allFound) {
    console.log('  ✅ PASS: All expected functions found');
  }
  
  return allFound;
}

// Test 2: Functions have proper documentation
function testRtnlFunctionDocumentation() {
  console.log('\n🧪 Testing RTNL function documentation:');
  
  const functions = ['request', 'listener', 'error'];
  let allHaveDoc = true;
  
  for (const funcName of functions) {
    const doc = rtnlTypeRegistry.getFunctionDocumentation(funcName);
    const hasDoc = doc && doc.length > 50; // Reasonable documentation length
    
    console.log(`  ${funcName}: ${hasDoc ? '✅ Has docs' : '❌ No docs'} (${doc ? doc.length : 0} chars)`);
    
    if (!hasDoc) {
      allHaveDoc = false;
    }
  }
  
  return allHaveDoc;
}

// Test 3: request() has correct return type
function testRtnlRequestReturnType() {
  console.log('\n🧪 Testing rtnl.request() return type:');
  
  const requestFunc = rtnlTypeRegistry.getFunction('request');
  if (!requestFunc) {
    console.log('  ❌ FAIL: request function not found');
    return false;
  }
  
  const returnType = requestFunc.returnType;
  const expectedType = 'object | null';
  
  console.log(`  Return type: "${returnType}"`);
  console.log(`  Expected: "${expectedType}"`);
  
  const isCorrect = returnType === expectedType;
  console.log(`  ✅ ${isCorrect ? 'PASS' : 'FAIL'}`);
  
  return isCorrect;
}

// Test 4: Function signature formatting
function testRtnlSignatureFormatting() {
  console.log('\n🧪 Testing RTNL function signature formatting:');
  
  const requestSignature = rtnlTypeRegistry.formatFunctionSignature('request');
  console.log(`  request signature: "${requestSignature}"`);
  
  const hasSignature = requestSignature && requestSignature.includes('request(') && requestSignature.includes('object | null');
  console.log(`  Has proper signature: ${hasSignature ? '✅ PASS' : '❌ FAIL'}`);
  
  return hasSignature;
}

// Test 5: Test completion item creation (mock the completion logic)
function testRtnlCompletionItemCreation() {
  console.log('\n🧪 Testing RTNL completion item creation:');
  
  const functionNames = rtnlTypeRegistry.getFunctionNames();
  let completionItems = [];
  
  // Mock the completion logic from getRtnlModuleCompletions
  for (const functionName of functionNames) {
    const signature = rtnlTypeRegistry.getFunction(functionName);
    if (signature) {
      completionItems.push({
        label: functionName,
        kind: 'Function',
        detail: 'rtnl module function',
        documentation: rtnlTypeRegistry.getFunctionDocumentation(functionName),
        insertText: `${functionName}($1)`
      });
    }
  }
  
  console.log(`  Created ${completionItems.length} completion items`);
  
  // Check that request completion has proper documentation
  const requestCompletion = completionItems.find(item => item.label === 'request');
  const hasRequestCompletion = requestCompletion && 
                               requestCompletion.documentation && 
                               requestCompletion.documentation.includes('netlink request');
  
  console.log(`  Request completion: ${hasRequestCompletion ? '✅ PASS' : '❌ FAIL'}`);
  
  return hasRequestCompletion && completionItems.length >= 3;
}

// Run all tests
let totalTests = 0;
let passedTests = 0;

const tests = [
  testRtnlRegistryFunctions,
  testRtnlFunctionDocumentation,
  testRtnlRequestReturnType,
  testRtnlSignatureFormatting,
  testRtnlCompletionItemCreation
];

for (const test of tests) {
  totalTests++;
  if (test()) {
    passedTests++;
  }
}

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All RTNL module completion tests passed!');
  console.log('\n✅ Regression Prevention:');
  console.log('  • rtnl.request() has proper return type "object | null"');
  console.log('  • rtnl module functions are properly registered');
  console.log('  • rtnl. autocomplete should work in VS Code');
  console.log('  • Function documentation is available');
} else {
  console.log('❌ Some tests failed - completion functionality may be broken');
  process.exit(1);
}