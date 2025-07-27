// Test suite for struct module completion and hover functionality
console.log('🧪 Running Struct Module Tests...\n');

const { structTypeRegistry } = require('../src/analysis/structTypes');

const expectedFunctions = [
  'pack', 'unpack', 'new', 'buffer'
];

let totalTests = 0;
let passedTests = 0;

function testStructValidation(testName, actualResult, expected) {
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

function testStructArrayValidation(testName, actualArray, expectedArray) {
  console.log(`🧪 Testing ${testName}:`);
  totalTests++;
  const result = JSON.stringify(actualArray.sort()) === JSON.stringify(expectedArray.sort());
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  if (!result) {
    console.log(`  Expected: ${JSON.stringify(expectedArray.sort())}`);
    console.log(`  Actual: ${JSON.stringify(actualArray.sort())}`);
  }
  if (result) passedTests++;
  return result;
}

function testStructStringIncludes(testName, actualString, expectedSubstring) {
  console.log(`🧪 Testing ${testName}:`);
  totalTests++;
  const result = actualString.includes(expectedSubstring);
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  if (!result) {
    console.log(`  Expected substring: ${expectedSubstring}`);
    console.log(`  Actual string: ${actualString.substring(0, 200)}...`);
  }
  if (result) passedTests++;
  return result;
}

// Test 1: All expected functions are present
const actualFunctions = structTypeRegistry.getFunctionNames();
testStructArrayValidation(
  'All expected struct functions are present',
  actualFunctions,
  expectedFunctions
);

// Test 2: Function signature formatting for pack
const packSignature = structTypeRegistry.formatFunctionSignature('pack');
testStructStringIncludes(
  'pack function signature formatting',
  packSignature,
  'pack(format: string, values: any): string'
);

// Test 3: Function signature formatting for unpack
const unpackSignature = structTypeRegistry.formatFunctionSignature('unpack');
testStructStringIncludes(
  'unpack function signature formatting',
  unpackSignature,
  'unpack(format: string, input: string, [offset: number] = 0): array'
);

// Test 4: Function signature formatting for new
const newSignature = structTypeRegistry.formatFunctionSignature('new');
testStructStringIncludes(
  'new function signature formatting',
  newSignature,
  'new(format: string): struct.instance'
);

// Test 5: Function signature formatting for buffer
const bufferSignature = structTypeRegistry.formatFunctionSignature('buffer');
testStructStringIncludes(
  'buffer function signature formatting',
  bufferSignature,
  'buffer([initialData: string]): struct.buffer'
);

// Test 6: Function documentation generation for pack
const packDoc = structTypeRegistry.getFunctionDocumentation('pack');
testStructStringIncludes(
  'pack function documentation includes description',
  packDoc,
  'Pack given values according to specified format'
);

// Test 7: Function documentation includes format characters
testStructStringIncludes(
  'pack documentation includes format characters',
  packDoc,
  'Format Characters'
);

// Test 8: Function documentation includes byte order info
testStructStringIncludes(
  'pack documentation includes byte order',
  packDoc,
  'Byte Order'
);

// Test 9: Function identification - valid functions
testStructValidation(
  'struct function identification (pack)',
  structTypeRegistry.isStructFunction('pack'),
  true
);

// Test 10: Function identification - invalid functions
testStructValidation(
  'struct function identification (invalid)',
  structTypeRegistry.isStructFunction('invalidFunction'),
  false
);

// Test 11: Return type handling for pack
const packFunc = structTypeRegistry.getFunction('pack');
testStructValidation(
  'pack function return type',
  packFunc ? packFunc.returnType : null,
  'string'
);

// Test 12: Return type handling for unpack
const unpackFunc = structTypeRegistry.getFunction('unpack');
testStructValidation(
  'unpack function return type',
  unpackFunc ? unpackFunc.returnType : null,
  'array'
);

// Test 13: Optional parameter handling for unpack
testStructValidation(
  'unpack function has optional offset parameter',
  unpackFunc ? unpackFunc.parameters[2].optional : false,
  true
);

// Test 14: Optional parameter handling for buffer
const bufferFunc = structTypeRegistry.getFunction('buffer');
testStructValidation(
  'buffer function has optional initialData parameter',
  bufferFunc ? bufferFunc.parameters[0].optional : false,
  true
);

// Test 15: Complex type signatures - struct.instance
const newFunc = structTypeRegistry.getFunction('new');
testStructValidation(
  'new function returns struct.instance',
  newFunc ? newFunc.returnType : null,
  'struct.instance'
);

// Test 16: Complex type signatures - struct.buffer
testStructValidation(
  'buffer function returns struct.buffer',
  bufferFunc ? bufferFunc.returnType : null,
  'struct.buffer'
);

// Test 17: Mock completion integration test
const mockCompletionItems = structTypeRegistry.getFunctionNames().map(name => ({
  label: name,
  documentation: structTypeRegistry.getFunctionDocumentation(name)
}));
testStructValidation(
  'completion integration test (correct count)',
  mockCompletionItems.length,
  expectedFunctions.length
);

// Test 18: Documentation formatting consistency
const unpackDoc = structTypeRegistry.getFunctionDocumentation('unpack');
testStructStringIncludes(
  'unpack documentation includes examples',
  unpackDoc,
  'Examples:'
);

// Test 19: Import validation - valid imports
testStructValidation(
  'import validation (valid pack)',
  structTypeRegistry.isValidImport('pack'),
  true
);

// Test 20: Import validation - invalid imports
testStructValidation(
  'import validation (invalid function)',
  structTypeRegistry.isValidImport('invalidFunction'),
  false
);

// Test 21: Get valid imports list
const validImports = structTypeRegistry.getValidImports();
testStructArrayValidation(
  'valid imports list matches function names',
  validImports,
  expectedFunctions
);

// Test 22: Function parameter types
testStructValidation(
  'pack function first parameter type',
  packFunc ? packFunc.parameters[0].type : null,
  'string'
);

// Test 23: Function parameter names
testStructValidation(
  'unpack function parameter names include format',
  unpackFunc ? unpackFunc.parameters[0].name : null,
  'format'
);

// Test 24: Documentation includes return type
testStructStringIncludes(
  'pack documentation includes return type',
  packDoc,
  '**Returns:** `string`'
);

// Test 25: Buffer documentation includes examples
const bufferDoc = structTypeRegistry.getFunctionDocumentation('buffer');
testStructStringIncludes(
  'buffer documentation includes examples',
  bufferDoc,
  'struct.buffer()'
);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All struct module tests passed!');
  process.exit(0);
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed`);
  process.exit(1);
}