// Test suite for error constants functionality
console.log('🔧 Running Error Constants Tests...\n');

const { UcodeErrorCode, UcodeErrorConstants } = require('../src/analysis/errorConstants');

const testCases = [
  {
    name: "Format simple error message",
    code: UcodeErrorCode.UNDEFINED_VARIABLE,
    params: ['myVar'],
    expected: "Undefined variable 'myVar'",
    shouldPass: true
  },
  {
    name: "Format complex error message with multiple params",
    code: UcodeErrorCode.TYPE_MISMATCH,
    params: ['string', 'number'],
    expected: "Type mismatch: expected 'string', got 'number'",
    shouldPass: true
  },
  {
    name: "Format parameter count error",
    code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
    params: ['2', '3'],
    expected: "Invalid parameter count: expected 2, got 3",
    shouldPass: true
  },
  {
    name: "Check warning categorization",
    code: UcodeErrorCode.UNUSED_VARIABLE,
    testType: 'isWarning',
    expected: true,
    shouldPass: true
  },
  {
    name: "Check error categorization", 
    code: UcodeErrorCode.UNDEFINED_FUNCTION,
    testType: 'isError',
    expected: true,
    shouldPass: true
  }
];

function testErrorConstants(testName, testCase) {
  console.log(`\n🧪 Testing ${testName}:`);
  
  let result;
  let actual;
  
  try {
    if (testCase.testType === 'isWarning') {
      actual = UcodeErrorConstants.isWarning(testCase.code);
    } else if (testCase.testType === 'isError') {
      actual = UcodeErrorConstants.isError(testCase.code);
    } else {
      actual = UcodeErrorConstants.formatMessage(testCase.code, ...testCase.params);
    }
    
    result = actual === testCase.expected;
    console.log(`  Expected: ${testCase.expected}`);
    console.log(`  Actual: ${actual}`);
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
  } catch (error) {
    console.log(`  Error: ${error.message}`);
    result = false;
  }
  
  return result;
}

// Test runner
let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
  totalTests++;
  if (testErrorConstants(testCase.name, testCase)) {
    passedTests++;
  }
});
