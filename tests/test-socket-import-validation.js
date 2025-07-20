// Test socket module import validation
console.log('🔧 Running Socket Import Validation Tests...\n');

const { socketTypeRegistry } = require('../src/analysis/socketTypes');

let totalTests = 0;
let passedTests = 0;

function testCase(name, testFunc) {
  console.log(`🧪 Testing ${name}:`);
  totalTests++;
  try {
    const result = testFunc();
    if (result) {
      console.log(`  Result: ✅ PASS`);
      passedTests++;
    } else {
      console.log(`  Result: ❌ FAIL`);
    }
  } catch (error) {
    console.log(`  Result: ❌ FAIL - ${error.message}`);
  }
  console.log('');
}

// Test 1: Valid function imports
testCase("Valid function imports", () => {
  const validFunctions = ['create', 'connect', 'listen', 'sockaddr', 'nameinfo', 'addrinfo', 'poll', 'error', 'strerror'];
  
  for (const funcName of validFunctions) {
    if (!socketTypeRegistry.isValidImport(funcName)) {
      console.log(`    Function '${funcName}' should be valid but was rejected`);
      return false;
    }
  }
  
  console.log(`    All ${validFunctions.length} valid functions accepted`);
  return true;
});

// Test 2: Valid constant imports
testCase("Valid constant imports", () => {
  const validConstants = ['AF_INET', 'AF_INET6', 'SOCK_STREAM', 'SOCK_DGRAM', 'SOL_SOCKET', 'SO_REUSEADDR', 'MSG_DONTWAIT', 'IPPROTO_TCP'];
  
  for (const constName of validConstants) {
    if (!socketTypeRegistry.isValidImport(constName)) {
      console.log(`    Constant '${constName}' should be valid but was rejected`);
      return false;
    }
  }
  
  console.log(`    All ${validConstants.length} valid constants accepted`);
  return true;
});

// Test 3: Invalid imports should be rejected
testCase("Invalid imports should be rejected", () => {
  const invalidImports = ['invalidFunction', 'INVALID_CONSTANT', 'socket_create', 'AF_INVALID', 'notReal'];
  
  for (const invalidName of invalidImports) {
    if (socketTypeRegistry.isValidImport(invalidName)) {
      console.log(`    Invalid import '${invalidName}' was incorrectly accepted`);
      return false;
    }
  }
  
  console.log(`    All ${invalidImports.length} invalid imports correctly rejected`);
  return true;
});

// Test 4: Case sensitivity
testCase("Case sensitivity", () => {
  // These should be rejected (wrong case)
  const wrongCaseImports = ['Create', 'CONNECT', 'af_inet', 'sock_stream', 'Sol_Socket'];
  
  for (const wrongCase of wrongCaseImports) {
    if (socketTypeRegistry.isValidImport(wrongCase)) {
      console.log(`    Wrong case import '${wrongCase}' was incorrectly accepted`);
      return false;
    }
  }
  
  console.log(`    Case sensitivity working correctly - rejected ${wrongCaseImports.length} wrong-case imports`);
  return true;
});

// Test 5: Complete valid imports list
testCase("Complete valid imports list", () => {
  const validImports = socketTypeRegistry.getValidImports();
  const functionCount = socketTypeRegistry.getFunctionNames().length;
  const constantCount = socketTypeRegistry.getConstantNames().length;
  
  if (validImports.length !== functionCount + constantCount) {
    console.log(`    Expected ${functionCount + constantCount} valid imports, got ${validImports.length}`);
    return false;
  }
  
  // Check that all returned imports are actually valid
  for (const importName of validImports) {
    if (!socketTypeRegistry.isValidImport(importName)) {
      console.log(`    Import '${importName}' in valid list but validation failed`);
      return false;
    }
  }
  
  console.log(`    Valid imports list complete with ${validImports.length} items`);
  return true;
});

// Test 6: Boundary tests - empty and null values
testCase("Boundary tests - empty and null values", () => {
  if (socketTypeRegistry.isValidImport('') || 
      socketTypeRegistry.isValidImport(null) || 
      socketTypeRegistry.isValidImport(undefined)) {
    console.log(`    Empty/null values incorrectly accepted as valid imports`);
    return false;
  }
  
  console.log(`    Empty/null values correctly rejected`);
  return true;
});

// Test 7: Specific socket constants validation
testCase("Specific socket constants validation", () => {
  const criticalConstants = [
    'AF_INET', 'AF_INET6', 'AF_UNIX',
    'SOCK_STREAM', 'SOCK_DGRAM', 
    'SOL_SOCKET', 'SO_REUSEADDR',
    'IPPROTO_TCP', 'IPPROTO_UDP',
    'MSG_DONTWAIT', 'MSG_NOSIGNAL'
  ];
  
  for (const constName of criticalConstants) {
    if (!socketTypeRegistry.isValidImport(constName)) {
      console.log(`    Critical constant '${constName}' not recognized as valid import`);
      return false;
    }
  }
  
  console.log(`    All ${criticalConstants.length} critical socket constants validated`);
  return true;
});

// Test 8: Error message quality simulation
testCase("Error message quality simulation", () => {
  // Simulate what error message would be generated for invalid imports
  const invalidImport = 'invalidSocketFunction';
  const validImports = socketTypeRegistry.getValidImports();
  
  if (socketTypeRegistry.isValidImport(invalidImport)) {
    console.log(`    Invalid import incorrectly accepted`);
    return false;
  }
  
  // Check that we have valid alternatives to suggest
  if (validImports.length === 0) {
    console.log(`    No valid imports available for error message suggestions`);
    return false;
  }
  
  console.log(`    Error message simulation: would have ${validImports.length} alternatives to suggest`);
  return true;
});

// Test 9: Mixed case common mistakes
testCase("Mixed case common mistakes", () => {
  const commonMistakes = [
    'Af_inet',    // Should be AF_INET
    'af_INET',    // Should be AF_INET  
    'Sock_stream', // Should be SOCK_STREAM
    'sock_STREAM', // Should be SOCK_STREAM
    'Create',     // Should be create
    'Connect'     // Should be connect
  ];
  
  for (const mistake of commonMistakes) {
    if (socketTypeRegistry.isValidImport(mistake)) {
      console.log(`    Common mistake '${mistake}' was incorrectly accepted`);
      return false;
    }
  }
  
  console.log(`    All ${commonMistakes.length} common case mistakes correctly rejected`);
  return true;
});

// Test 10: Comprehensive validation test
testCase("Comprehensive validation test", () => {
  const allFunctions = socketTypeRegistry.getFunctionNames();
  const allConstants = socketTypeRegistry.getConstantNames();
  
  // Test that every function and constant is valid for import
  for (const funcName of allFunctions) {
    if (!socketTypeRegistry.isValidImport(funcName)) {
      console.log(`    Function '${funcName}' should be valid for import`);
      return false;
    }
  }
  
  for (const constName of allConstants) {
    if (!socketTypeRegistry.isValidImport(constName)) {
      console.log(`    Constant '${constName}' should be valid for import`);
      return false;
    }
  }
  
  console.log(`    All ${allFunctions.length} functions and ${allConstants.length} constants pass validation`);
  return true;
});

console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);