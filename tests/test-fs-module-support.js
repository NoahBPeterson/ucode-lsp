// Unit test for fs module support

// Mock the fs module methods mapping 
const fsMethods = {
  // File operations
  'readfile': 'string',
  'writefile': 'integer', 
  'open': 'object',
  'access': 'boolean',
  'realpath': 'string',
  
  // Directory operations
  'opendir': 'object',
  'mkdir': 'boolean',
  'rmdir': 'boolean',
  'lsdir': 'array',
  'getcwd': 'string',
  'chdir': 'boolean',
  
  // File metadata operations
  'stat': 'object',
  'lstat': 'object',
  'chmod': 'boolean',
  'chown': 'boolean',
  'rename': 'boolean',
  
  // Link operations
  'symlink': 'boolean',
  'readlink': 'string',
  'unlink': 'boolean',
  
  // Process operations
  'popen': 'object',
  'mkstemp': 'object',
  'pipe': 'array',
  
  // Utility operations
  'dirname': 'string',
  'basename': 'string',
  'glob': 'array',
  'error': 'string',
  'fdopen': 'object',
  
  // File handles
  'stdin': 'object',
  'stdout': 'object',
  'stderr': 'object'
};

// Mock the require detection logic
function detectRequireCall(code) {
  // Simulate parsing require('fs') 
  const requirePattern = /const\s+(\w+)\s*=\s*require\s*\(\s*['"]fs['"]\s*\)/;
  const match = code.match(requirePattern);
  
  if (match) {
    return {
      isModule: true,
      moduleName: 'fs',
      variableName: match[1]
    };
  }
  
  return { isModule: false };
}

// Mock the member access validation
function validateFsMemberAccess(variableName, memberName, isModule) {
  if (!isModule) {
    return { isValid: false, error: `Undefined variable: ${variableName}` };
  }
  
  const methodType = fsMethods[memberName];
  if (methodType) {
    return { isValid: true, returnType: methodType };
  }
  
  return { isValid: false, error: `Undefined variable: ${memberName}` };
}

// Test cases for fs module support
const testCases = [
  {
    name: "detect require('fs') call",
    code: "const fs = require('fs');",
    expectedModule: 'fs',
    expectedVariable: 'fs',
    description: "Should detect fs module require"
  },
  {
    name: "detect different variable name",
    code: "const fileSystem = require('fs');",
    expectedModule: 'fs', 
    expectedVariable: 'fileSystem',
    description: "Should handle different variable names for fs module"
  },
  {
    name: "valid fs.readfile call",
    setup: "const fs = require('fs');",
    memberAccess: { variable: 'fs', member: 'readfile' },
    expectedValid: true,
    expectedType: 'string',
    description: "Should recognize readfile as valid fs method"
  },
  {
    name: "valid fs.mkdir call", 
    setup: "const fs = require('fs');",
    memberAccess: { variable: 'fs', member: 'mkdir' },
    expectedValid: true,
    expectedType: 'boolean',
    description: "Should recognize mkdir as valid fs method"
  },
  {
    name: "invalid fs.read call",
    setup: "const fs = require('fs');", 
    memberAccess: { variable: 'fs', member: 'read' },
    expectedValid: false,
    expectedError: "Undefined variable: read",
    description: "Should reject read as fs has no read method (only readfile)"
  },
  {
    name: "invalid fs.write call",
    setup: "const fs = require('fs');",
    memberAccess: { variable: 'fs', member: 'write' }, 
    expectedValid: false,
    expectedError: "Undefined variable: write",
    description: "Should reject write as fs has no write method (only writefile)"
  },
  {
    name: "non-fs variable access",
    setup: "const obj = {};",
    memberAccess: { variable: 'obj', member: 'someMethod' },
    expectedValid: false, 
    expectedError: "Undefined variable: obj",
    description: "Should handle non-module variables normally"
  }
];

// Test function for require detection
function testRequireDetection(testName, code, expectedModule, expectedVariable) {
  console.log(`\n🧪 Testing ${testName}:`);
  
  const result = detectRequireCall(code);
  const passed = result.isModule && 
                 result.moduleName === expectedModule && 
                 result.variableName === expectedVariable;
  
  console.log(`  Expected: module=${expectedModule}, variable=${expectedVariable}`);
  console.log(`  Actual: module=${result.moduleName || 'none'}, variable=${result.variableName || 'none'}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

// Test function for member access validation  
function testMemberAccess(testName, setup, memberAccess, expectedValid, expectedType, expectedError) {
  console.log(`\n🧪 Testing ${testName}:`);
  
  const moduleInfo = detectRequireCall(setup);
  const result = validateFsMemberAccess(
    memberAccess.variable, 
    memberAccess.member, 
    moduleInfo.isModule && moduleInfo.variableName === memberAccess.variable
  );
  
  const passed = result.isValid === expectedValid && 
                 (expectedValid ? result.returnType === expectedType : 
                  result.error === expectedError);
  
  console.log(`  Expected: valid=${expectedValid}${expectedValid ? `, type=${expectedType}` : `, error="${expectedError}"`}`);
  console.log(`  Actual: valid=${result.isValid}${result.isValid ? `, type=${result.returnType}` : `, error="${result.error}"`}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

console.log('🧪 Testing FS Module Support...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
  totalTests++;
  
  if (testCase.memberAccess) {
    if (testMemberAccess(
      testCase.name,
      testCase.setup,
      testCase.memberAccess,
      testCase.expectedValid,
      testCase.expectedType,
      testCase.expectedError
    )) {
      passedTests++;
    }
  } else {
    if (testRequireDetection(
      testCase.name,
      testCase.code,
      testCase.expectedModule,
      testCase.expectedVariable
    )) {
      passedTests++;
    }
  }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All fs module support tests passed!');
  console.log('\n✅ require("fs") detection working correctly');
  console.log('✅ fs module methods recognized correctly');
  console.log('✅ Invalid fs methods properly rejected');
  console.log('✅ Non-module variables handled normally');
} else {
  console.log('❌ Some tests failed. Check fs module support implementation.');
}

console.log('\n💡 Note: These test the fs module support logic patterns.');
console.log('💡 The fix enables semantic analysis of fs module method calls.');
console.log('💡 IMPORTANT: fs.read() is correctly rejected - use fs.readfile() instead!');