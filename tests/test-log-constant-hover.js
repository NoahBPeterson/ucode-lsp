// Test log constant hover documentation
console.log('🧪 Testing Log Constant Hover Documentation...\n');

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

// Test 1: LOG_INFO constant documentation
const logInfoDoc = logTypeRegistry.getConstantDocumentation('LOG_INFO');
const hasLogInfoDoc = logInfoDoc && logInfoDoc.includes('LOG_INFO') && logInfoDoc.includes('Informational message');
testResult('LOG_INFO constant documentation', hasLogInfoDoc,
  `Has documentation: ${!!logInfoDoc}`);

// Test 2: LOG_ERR constant documentation
const logErrDoc = logTypeRegistry.getConstantDocumentation('LOG_ERR');
const hasLogErrDoc = logErrDoc && logErrDoc.includes('LOG_ERR') && logErrDoc.includes('Error conditions');
testResult('LOG_ERR constant documentation', hasLogErrDoc,
  `Has documentation: ${!!logErrDoc}`);

// Test 3: LOG_PID constant documentation
const logPidDoc = logTypeRegistry.getConstantDocumentation('LOG_PID');
const hasLogPidDoc = logPidDoc && logPidDoc.includes('LOG_PID') && logPidDoc.includes('Include PID');
testResult('LOG_PID constant documentation', hasLogPidDoc,
  `Has documentation: ${!!logPidDoc}`);

// Test 4: LOG_USER constant documentation
const logUserDoc = logTypeRegistry.getConstantDocumentation('LOG_USER');
const hasLogUserDoc = logUserDoc && logUserDoc.includes('LOG_USER') && logUserDoc.includes('Generic user-level');
testResult('LOG_USER constant documentation', hasLogUserDoc,
  `Has documentation: ${!!logUserDoc}`);

// Test 5: ULOG_SYSLOG constant documentation
const ulogSyslogDoc = logTypeRegistry.getConstantDocumentation('ULOG_SYSLOG');
const hasUlogSyslogDoc = ulogSyslogDoc && ulogSyslogDoc.includes('ULOG_SYSLOG') && ulogSyslogDoc.includes('OpenWrt');
testResult('ULOG_SYSLOG constant documentation', hasUlogSyslogDoc,
  `Has documentation: ${!!ulogSyslogDoc}`);

// Test 6: Invalid constant returns undefined
const invalidConstantDoc = logTypeRegistry.getConstantDocumentation('INVALID_CONSTANT');
testResult('Invalid constant returns undefined', invalidConstantDoc === undefined,
  `Returns undefined for invalid constants`);

// Test 7: All priority constants have documentation
const priorityConstants = ['LOG_EMERG', 'LOG_ALERT', 'LOG_CRIT', 'LOG_ERR', 'LOG_WARNING', 'LOG_NOTICE', 'LOG_INFO', 'LOG_DEBUG'];
const allPrioritiesHaveDoc = priorityConstants.every(constant => {
  const doc = logTypeRegistry.getConstantDocumentation(constant);
  return doc && doc.includes(constant) && doc.includes('Log Priority Constant');
});
testResult('All priority constants have documentation', allPrioritiesHaveDoc,
  `Priority constants checked: ${priorityConstants.length}`);

// Test 8: All facility constants have documentation
const facilityConstants = ['LOG_USER', 'LOG_DAEMON', 'LOG_AUTH', 'LOG_LOCAL0', 'LOG_LOCAL1'];
const allFacilitiesHaveDoc = facilityConstants.every(constant => {
  const doc = logTypeRegistry.getConstantDocumentation(constant);
  return doc && doc.includes(constant) && doc.includes('Log Facility Constant');
});
testResult('All facility constants have documentation', allFacilitiesHaveDoc,
  `Facility constants checked: ${facilityConstants.length}`);

// Test 9: All option constants have documentation
const optionConstants = ['LOG_PID', 'LOG_CONS', 'LOG_NDELAY', 'LOG_ODELAY', 'LOG_NOWAIT'];
const allOptionsHaveDoc = optionConstants.every(constant => {
  const doc = logTypeRegistry.getConstantDocumentation(constant);
  return doc && doc.includes(constant) && doc.includes('Log Option Constant');
});
testResult('All option constants have documentation', allOptionsHaveDoc,
  `Option constants checked: ${optionConstants.length}`);

// Test 10: All ulog constants have documentation
const ulogConstants = ['ULOG_KMSG', 'ULOG_SYSLOG', 'ULOG_STDIO'];
const allUlogHaveDoc = ulogConstants.every(constant => {
  const doc = logTypeRegistry.getConstantDocumentation(constant);
  return doc && doc.includes(constant) && doc.includes('Ulog Channel Constant');
});
testResult('All ulog constants have documentation', allUlogHaveDoc,
  `Ulog constants checked: ${ulogConstants.length}`);

// Test 11: Documentation formatting consistency
const sampleDoc = logTypeRegistry.getConstantDocumentation('LOG_INFO');
const hasMarkdownFormatting = sampleDoc && sampleDoc.includes('**') && sampleDoc.includes('*Log Priority Constant*');
testResult('Documentation formatting consistency', hasMarkdownFormatting,
  `Has proper markdown formatting`);

// Test 12: Usage information included
const sampleUsageDoc = logTypeRegistry.getConstantDocumentation('LOG_INFO');
const hasUsageInfo = sampleUsageDoc && sampleUsageDoc.includes('Used with') && sampleUsageDoc.includes('syslog()');
testResult('Usage information included', hasUsageInfo,
  `Includes usage context`);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All log constant hover tests passed!');
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed. Please check the implementation.`);
  process.exit(1);
}