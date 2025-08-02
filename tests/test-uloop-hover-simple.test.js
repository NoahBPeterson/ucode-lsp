// Simple test to verify uloop delete() method definitions exist
console.log('🧪 Running Uloop Delete Method Tests...\n');

// Import the source TypeScript module directly (without .ts extension)
const { uloopObjectRegistry } = require('../src/analysis/uloopTypes');

let totalTests = 0;
let passedTests = 0;

function testUloopValidation(testName, actualResult, expected) {
  console.log(`🧪 Testing ${testName}:`);
  totalTests++;
  const result = actualResult === expected;
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  if (!result) {
    console.log(`  Expected: ${expected}`);
    console.log(`  Actual: ${actualResult}`);
  }
  if (result) passedTests++;
  return result;
}

function testUloopMethod(objectType, methodName, expectedDescription) {
  console.log(`🧪 Testing ${objectType}.${methodName}() method:`);
  totalTests++;
  
  const method = uloopObjectRegistry.getUloopMethod(objectType, methodName);
  const exists = method !== undefined;
  const hasCorrectName = exists && method.name === methodName;
  const hasDescription = exists && method.description && method.description.includes(expectedDescription);
  
  const result = exists && hasCorrectName && hasDescription;
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  
  if (!result) {
    console.log(`  Method exists: ${exists}`);
    if (exists) {
      console.log(`  Method name: ${method.name}`);
      console.log(`  Method description: ${method.description}`);
    }
  }
  
  if (result) passedTests++;
  return result;
}

// Test that delete methods exist and have proper descriptions
console.log('📋 Testing delete() method definitions:\n');

testUloopMethod('uloop.handle', 'delete', 'Unregisters the uloop handle');
testUloopMethod('uloop.process', 'delete', 'Unregisters the process');
testUloopMethod('uloop.signal', 'delete', 'Uninstalls the signal handler');

// Test that other methods exist too (to verify the registry is working)
console.log('\n📋 Testing other uloop methods:\n');

testUloopMethod('uloop.handle', 'fileno', 'Returns the file descriptor');
testUloopMethod('uloop.handle', 'handle', 'Returns the underlying file');
testUloopMethod('uloop.process', 'pid', 'Returns the process ID'); 
testUloopMethod('uloop.signal', 'signo', 'Returns the signal number');

// Test method lists
console.log('\n📋 Testing method availability:\n');

const handleMethods = uloopObjectRegistry.getMethodsForType('uloop.handle');
const processMethods = uloopObjectRegistry.getMethodsForType('uloop.process');
const signalMethods = uloopObjectRegistry.getMethodsForType('uloop.signal');

testUloopValidation('Handle has delete method', handleMethods.includes('delete'), true);
testUloopValidation('Process has delete method', processMethods.includes('delete'), true);
testUloopValidation('Signal has delete method', signalMethods.includes('delete'), true);

console.log('\n📊 Test Results:');
console.log(`Tests passed: ${passedTests}/${totalTests}`);
console.log(`Success rate: ${Math.round((passedTests/totalTests) * 100)}%\n`);

if (passedTests === totalTests) {
  console.log('🎉 All uloop delete() method tests passed!');
  console.log('✅ Delete methods are properly defined for all uloop object types');
  console.log('✅ Method descriptions are correct and will show in hover');
} else {
  console.log('❌ Some tests failed. Check the output above for details.');
  process.exit(1);
}