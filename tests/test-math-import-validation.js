// Test math module import validation
console.log('🧮 Testing Math Module Import Validation...\n');

const { mathTypeRegistry } = require('../src/analysis/mathTypes');

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

// Test 1: Valid math function validation
const validFunctions = ['abs', 'sin', 'cos', 'pow', 'sqrt'];
const allValidFunctions = validFunctions.every(func => mathTypeRegistry.isValidMathImport(func));
testResult('Valid math function validation', allValidFunctions,
  `All functions are valid: ${allValidFunctions}`);

// Test 2: Invalid math function validation
const invalidFunctions = ['invalidFunction', 'notAFunction', 'wrongFunction'];
const allInvalidFunctions = invalidFunctions.every(func => !mathTypeRegistry.isValidMathImport(func));
testResult('Invalid math function validation', allInvalidFunctions,
  `All functions are invalid: ${allInvalidFunctions}`);

// Test 3: Mixed valid and invalid validation
const mixedFunctions = ['sin', 'cos', 'notAFunction', 'pow'];
const validCount = mixedFunctions.filter(func => mathTypeRegistry.isValidMathImport(func)).length;
const invalidCount = mixedFunctions.filter(func => !mathTypeRegistry.isValidMathImport(func)).length;
testResult('Mixed valid and invalid validation', validCount === 3 && invalidCount === 1,
  `Valid: ${validCount}, Invalid: ${invalidCount}`);

// Test 4: All valid math functions validation
const allMathFunctions = ['abs', 'atan2', 'cos', 'exp', 'log', 'sin', 'sqrt', 'pow', 'rand', 'srand', 'isnan'];
const allValidMathFunctions = allMathFunctions.every(func => mathTypeRegistry.isValidMathImport(func));
testResult('All valid math functions validation', allValidMathFunctions,
  `All ${allMathFunctions.length} functions are valid: ${allValidMathFunctions}`);

// Test 5: Available exports list
const availableExports = mathTypeRegistry.getValidMathImports();
const exportsMatchExpected = availableExports.length === 11 && availableExports.includes('abs') && availableExports.includes('sin');
testResult('Available exports list', exportsMatchExpected,
  `Available exports: ${availableExports.length}, Contains abs and sin: ${exportsMatchExpected}`);

// Test 6: Case sensitivity validation
const caseSensitiveFunctions = ['ABS', 'Sin', 'COS'];
const allCaseSensitiveFailed = caseSensitiveFunctions.every(func => !mathTypeRegistry.isValidMathImport(func));
testResult('Case sensitivity validation', allCaseSensitiveFailed,
  `Case sensitive functions should fail: ${allCaseSensitiveFailed}`);

// Test 7: Function name completeness
const expectedFunctionNames = ['abs', 'atan2', 'cos', 'exp', 'log', 'sin', 'sqrt', 'pow', 'rand', 'srand', 'isnan'];
const actualFunctionNames = mathTypeRegistry.getFunctionNames();
const completenessCheck = expectedFunctionNames.every(name => actualFunctionNames.includes(name));
testResult('Function name completeness', completenessCheck,
  `Expected: ${expectedFunctionNames.length}, Actual: ${actualFunctionNames.length}`);

// Test 8: Validation method consistency
const testFunction = 'abs';
const methodConsistency = mathTypeRegistry.isValidMathImport(testFunction) === mathTypeRegistry.isMathFunction(testFunction);
testResult('Validation method consistency', methodConsistency,
  `isValidMathImport and isMathFunction are consistent: ${methodConsistency}`);

// Test 9: Empty string validation
const emptyStringValid = !mathTypeRegistry.isValidMathImport('');
testResult('Empty string validation', emptyStringValid,
  `Empty string should be invalid: ${emptyStringValid}`);

// Test 10: Null/undefined validation
const nullValid = !mathTypeRegistry.isValidMathImport(null);
const undefinedValid = !mathTypeRegistry.isValidMathImport(undefined);
testResult('Null/undefined validation', nullValid && undefinedValid,
  `Null and undefined should be invalid: ${nullValid && undefinedValid}`);

// Test 11: Special characters validation
const specialChars = ['abs()', 'sin-cos', 'pow.x', 'sqrt_2'];
const specialCharsValid = specialChars.every(func => !mathTypeRegistry.isValidMathImport(func));
testResult('Special characters validation', specialCharsValid,
  `Special characters should be invalid: ${specialCharsValid}`);

// Test 12: Valid imports matches function names
const validImports = mathTypeRegistry.getValidMathImports();
const functionNames = mathTypeRegistry.getFunctionNames();
const importsFunctionMatch = validImports.length === functionNames.length &&
  validImports.every(imp => functionNames.includes(imp));
testResult('Valid imports matches function names', importsFunctionMatch,
  `Valid imports perfectly match function names: ${importsFunctionMatch}`);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All math module import validation tests passed!');
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed. Please check the implementation.`);
  process.exit(1);
}