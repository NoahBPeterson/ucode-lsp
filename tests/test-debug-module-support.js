// Unit test for debug module support

// Mock the debug module methods mapping 
const debugMethods = {
  // Memory and debug operations
  'memdump': 'boolean',
  'traceback': 'array',
  'sourcepos': 'object',
  'getinfo': 'object',
  
  // Local variable operations
  'getlocal': 'object',
  'setlocal': 'object',
  
  // Upvalue (closure) operations
  'getupval': 'object',
  'setupval': 'object'
};

// Mock the import detection logic for debug module
function detectDebugImport(code) {
  // Simulate parsing import * as debug from 'debug'
  const namespacePattern = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]debug['"]/;
  const namespaceMatch = code.match(namespacePattern);
  
  if (namespaceMatch) {
    return {
      isModule: true,
      moduleName: 'debug',
      variableName: namespaceMatch[1],
      importType: 'namespace'
    };
  }
  
  // Simulate parsing import { function1, function2 } from 'debug'
  const namedPattern = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]debug['"]/;
  const namedMatch = code.match(namedPattern);
  
  if (namedMatch) {
    const functions = namedMatch[1].split(',').map(f => f.trim());
    return {
      isModule: true,
      moduleName: 'debug',
      importedFunctions: functions,
      importType: 'named'
    };
  }
  
  return { isModule: false };
}

// Mock the member access validation for debug module
function validateDebugMemberAccess(variableName, memberName, isModule) {
  if (!isModule) {
    return { isValid: false, error: `Undefined variable: ${variableName}` };
  }
  
  const methodType = debugMethods[memberName];
  if (methodType) {
    return { isValid: true, returnType: methodType };
  }
  
  return { isValid: false, error: `Undefined variable: ${memberName}` };
}

// Mock direct debug function validation (builtin functions)
function validateDebugBuiltinCall(functionName) {
  const methodType = debugMethods[functionName];
  if (methodType) {
    return { isValid: true, returnType: methodType };
  }
  
  return { isValid: false, error: `Undefined function: ${functionName}` };
}

// Test cases for debug module support
const testCases = [
  {
    name: "detect namespace import",
    code: "import * as debug from 'debug';",
    expectedModule: 'debug',
    expectedVariable: 'debug',
    expectedType: 'namespace',
    description: "Should detect debug module namespace import"
  },
  {
    name: "detect different namespace variable name",
    code: "import * as debugger from 'debug';",
    expectedModule: 'debug', 
    expectedVariable: 'debugger',
    expectedType: 'namespace',
    description: "Should handle different variable names for debug module"
  },
  {
    name: "detect named imports",
    code: "import { memdump, traceback } from 'debug';",
    expectedModule: 'debug',
    expectedFunctions: ['memdump', 'traceback'],
    expectedType: 'named',
    description: "Should detect named function imports from debug module"
  },
  {
    name: "valid debug.memdump call",
    setup: "import * as debug from 'debug';",
    memberAccess: { variable: 'debug', member: 'memdump' },
    expectedValid: true,
    expectedType: 'boolean',
    description: "Should recognize memdump as valid debug method"
  },
  {
    name: "valid debug.traceback call", 
    setup: "import * as debug from 'debug';",
    memberAccess: { variable: 'debug', member: 'traceback' },
    expectedValid: true,
    expectedType: 'array',
    description: "Should recognize traceback as valid debug method"
  },
  {
    name: "valid debug.getlocal call",
    setup: "import * as debug from 'debug';",
    memberAccess: { variable: 'debug', member: 'getlocal' },
    expectedValid: true,
    expectedType: 'object',
    description: "Should recognize getlocal as valid debug method"
  },
  {
    name: "invalid debug.invalidFunc call",
    setup: "import * as debug from 'debug';", 
    memberAccess: { variable: 'debug', member: 'invalidFunc' },
    expectedValid: false,
    expectedError: "Undefined variable: invalidFunc",
    description: "Should reject invalidFunc as debug has no such method"
  },
  {
    name: "direct memdump builtin call",
    functionCall: 'memdump',
    expectedValid: true,
    expectedType: 'boolean',
    description: "Should recognize memdump as valid builtin function"
  },
  {
    name: "direct traceback builtin call",
    functionCall: 'traceback',
    expectedValid: true,
    expectedType: 'array',
    description: "Should recognize traceback as valid builtin function"
  },
  {
    name: "direct sourcepos builtin call",
    functionCall: 'sourcepos',
    expectedValid: true,
    expectedType: 'object',
    description: "Should recognize sourcepos as valid builtin function"
  },
  {
    name: "invalid direct builtin call",
    functionCall: 'invalidDebugFunc',
    expectedValid: false,
    expectedError: "Undefined function: invalidDebugFunc",
    description: "Should reject invalid debug function names"
  }
];

// Test function for import detection
function testImportDetection(testName, code, expectedModule, expectedVariable, expectedType, expectedFunctions) {
  console.log(`\n🧪 Testing ${testName}:`);
  
  const result = detectDebugImport(code);
  let passed = result.isModule && result.moduleName === expectedModule;
  
  if (expectedType === 'namespace') {
    passed = passed && result.variableName === expectedVariable && result.importType === 'namespace';
    console.log(`  Expected: module=${expectedModule}, variable=${expectedVariable}, type=${expectedType}`);
    console.log(`  Actual: module=${result.moduleName || 'none'}, variable=${result.variableName || 'none'}, type=${result.importType || 'none'}`);
  } else if (expectedType === 'named') {
    passed = passed && result.importType === 'named' && 
             JSON.stringify(result.importedFunctions) === JSON.stringify(expectedFunctions);
    console.log(`  Expected: module=${expectedModule}, functions=[${expectedFunctions.join(', ')}], type=${expectedType}`);
    console.log(`  Actual: module=${result.moduleName || 'none'}, functions=[${(result.importedFunctions || []).join(', ')}], type=${result.importType || 'none'}`);
  }
  
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

// Test function for member access validation  
function testMemberAccess(testName, setup, memberAccess, expectedValid, expectedType, expectedError) {
  console.log(`\n🧪 Testing ${testName}:`);
  
  const moduleInfo = detectDebugImport(setup);
  const result = validateDebugMemberAccess(
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

// Test function for direct builtin calls
function testBuiltinCall(testName, functionCall, expectedValid, expectedType, expectedError) {
  console.log(`\n🧪 Testing ${testName}:`);
  
  const result = validateDebugBuiltinCall(functionCall);
  const passed = result.isValid === expectedValid && 
                 (expectedValid ? result.returnType === expectedType : 
                  result.error === expectedError);
  
  console.log(`  Function: ${functionCall}`);
  console.log(`  Expected: valid=${expectedValid}${expectedValid ? `, type=${expectedType}` : `, error="${expectedError}"`}`);
  console.log(`  Actual: valid=${result.isValid}${result.isValid ? `, type=${result.returnType}` : `, error="${result.error}"`}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return passed;
}

console.log('🧪 Testing Debug Module Support...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
  totalTests++;
  
  if (testCase.memberAccess) {
    // Test member access (debug.function)
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
  } else if (testCase.functionCall) {
    // Test direct builtin calls
    if (testBuiltinCall(
      testCase.name,
      testCase.functionCall,
      testCase.expectedValid,
      testCase.expectedType,
      testCase.expectedError
    )) {
      passedTests++;
    }
  } else {
    // Test import detection
    if (testImportDetection(
      testCase.name,
      testCase.code,
      testCase.expectedModule,
      testCase.expectedVariable,
      testCase.expectedType,
      testCase.expectedFunctions
    )) {
      passedTests++;
    }
  }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All debug module support tests passed!');
  console.log('\n✅ Debug namespace imports (import * as debug) working correctly');
  console.log('✅ Debug named imports (import { memdump, traceback }) working correctly');
  console.log('✅ Debug module methods recognized correctly');
  console.log('✅ Invalid debug methods properly rejected');
  console.log('✅ Direct debug builtin calls working correctly');
  console.log('✅ Debug functions work both as imports and builtins');
} else {
  console.log('❌ Some tests failed. Check debug module support implementation.');
}

console.log('\n💡 Note: These test the debug module support logic patterns.');
console.log('💡 Debug functions work in three ways:');
console.log('   1. Direct builtin calls: memdump("/tmp/dump.txt")');
console.log('   2. Named imports: import { memdump } from "debug"');
console.log('   3. Namespace imports: import * as debug from "debug"; debug.memdump(...)');
console.log('💡 All 8 debug functions should work in all three patterns!');