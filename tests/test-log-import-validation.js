// Test log module import validation
console.log('🧪 Testing Log Module Import Validation...\n');

const { logTypeRegistry } = require('../src/analysis/logTypes');

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

// Test 1: Valid function imports
const validFunctions = ['openlog', 'syslog', 'closelog', 'ulog_open', 'ulog', 'ulog_close', 'ulog_threshold', 'INFO', 'NOTE', 'WARN', 'ERR'];
const allValidFunctions = validFunctions.every(func => logTypeRegistry.isValidLogImport(func));
testResult('Valid function imports', allValidFunctions, 
  `Functions checked: ${validFunctions.join(', ')}`);

// Test 2: Valid constant imports
const validConstants = ['LOG_PID', 'LOG_USER', 'LOG_ERR', 'LOG_INFO', 'LOG_DEBUG', 'ULOG_SYSLOG', 'ULOG_KMSG'];
const allValidConstants = validConstants.every(constant => logTypeRegistry.isValidLogImport(constant));
testResult('Valid constant imports', allValidConstants,
  `Constants checked: ${validConstants.join(', ')}`);

// Test 3: Invalid imports should be rejected
const invalidImports = ['fake_function', 'INVALID_CONSTANT', 'LOG_FAKE', 'ulog_fake', 'BAD_IMPORT', 'definitely_not_real'];
const allInvalidRejected = invalidImports.every(invalid => !logTypeRegistry.isValidLogImport(invalid));
testResult('Invalid imports rejected', allInvalidRejected,
  `Invalid imports checked: ${invalidImports.join(', ')}`);

// Test 4: Function detection
const functionDetection = logTypeRegistry.isLogFunction('openlog') && !logTypeRegistry.isLogFunction('LOG_PID');
testResult('Function detection', functionDetection,
  'openlog is function, LOG_PID is not function');

// Test 5: Constant detection
const constantDetection = logTypeRegistry.isLogConstant('LOG_PID') && !logTypeRegistry.isLogConstant('openlog');
testResult('Constant detection', constantDetection,
  'LOG_PID is constant, openlog is not constant');

// Test 6: Available imports list
const availableImports = logTypeRegistry.getValidLogImports();
const hasExpectedCount = availableImports.length > 30; // Should have functions + constants
testResult('Available imports list', hasExpectedCount,
  `Total available imports: ${availableImports.length}`);

// Test 7: Mixed valid imports
const mixedValidImports = ['openlog', 'LOG_ERR', 'ulog', 'ULOG_SYSLOG', 'INFO', 'LOG_DEBUG'];
const allMixedValid = mixedValidImports.every(item => logTypeRegistry.isValidLogImport(item));
testResult('Mixed valid imports', allMixedValid,
  `Mixed imports: ${mixedValidImports.join(', ')}`);

// Test 8: Case sensitivity
const caseSensitiveTest = !logTypeRegistry.isValidLogImport('log_pid') && !logTypeRegistry.isValidLogImport('Openlog');
testResult('Case sensitivity', caseSensitiveTest,
  'log_pid and Openlog should be invalid (case sensitive)');

// Test 9: Empty/null imports
const emptyImports = !logTypeRegistry.isValidLogImport('') && !logTypeRegistry.isValidLogImport(null);
testResult('Empty/null imports', emptyImports,
  'Empty string and null should be invalid');

// Test 10: All ulog functions available
const ulogFunctions = ['ulog_open', 'ulog', 'ulog_close', 'ulog_threshold', 'INFO', 'NOTE', 'WARN', 'ERR'];
const allUlogValid = ulogFunctions.every(func => logTypeRegistry.isValidLogImport(func));
testResult('Ulog functions available', allUlogValid,
  `Ulog functions: ${ulogFunctions.join(', ')}`);

// Test 11: All priority constants available
const priorityConstants = ['LOG_EMERG', 'LOG_ALERT', 'LOG_CRIT', 'LOG_ERR', 'LOG_WARNING', 'LOG_NOTICE', 'LOG_INFO', 'LOG_DEBUG'];
const allPrioritiesValid = priorityConstants.every(constant => logTypeRegistry.isValidLogImport(constant));
testResult('Priority constants available', allPrioritiesValid,
  `Priority constants: ${priorityConstants.join(', ')}`);

// Test 12: All facility constants available
const facilityConstants = ['LOG_USER', 'LOG_DAEMON', 'LOG_LOCAL0', 'LOG_LOCAL1', 'LOG_AUTH', 'LOG_KERN'];
const allFacilitiesValid = facilityConstants.every(constant => logTypeRegistry.isValidLogImport(constant));
testResult('Facility constants available', allFacilitiesValid,
  `Facility constants: ${facilityConstants.join(', ')}`);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All log import validation tests passed!');
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed. Please check the implementation.`);
  process.exit(1);
}