// Test suite for log module completion and hover functionality
console.log('🔧 Running Log Module Tests...\n');

const { logTypeRegistry } = require('../src/analysis/logTypes');

const expectedFunctions = [
  'openlog', 'syslog', 'closelog', 'ulog_open', 'ulog', 'ulog_close', 
  'ulog_threshold', 'INFO', 'NOTE', 'WARN', 'ERR'
];

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

// Test 1: All expected functions are present
const detectedFunctions = logTypeRegistry.getFunctionNames();
const allFunctionsPresent = expectedFunctions.every(func => detectedFunctions.includes(func));
testResult('All expected functions are present', allFunctionsPresent, 
  `Expected: ${expectedFunctions.length}, Found: ${detectedFunctions.length}`);

// Test 2: Function signature formatting
const openlogSignature = logTypeRegistry.formatFunctionSignature('openlog');
const expectedOpenlogSignature = 'openlog([ident: string], [options: number | string | string[]], [facility: number | string] = user): boolean';
testResult('Function signature formatting (openlog)', openlogSignature === expectedOpenlogSignature,
  `Got: "${openlogSignature}"`);

// Test 3: Function documentation generation
const syslogDocs = logTypeRegistry.getFunctionDocumentation('syslog');
const hasSyslogDescription = syslogDocs.includes('Log a message to the system logger');
const hasSyslogParams = syslogDocs.includes('**Parameters:**');
const hasSyslogReturns = syslogDocs.includes('**Returns:** `boolean`');
testResult('Function documentation generation (syslog)', 
  hasSyslogDescription && hasSyslogParams && hasSyslogReturns,
  `Has description: ${hasSyslogDescription}, Has params: ${hasSyslogParams}, Has returns: ${hasSyslogReturns}`);

// Test 4: Function parameter handling
const ulogFunction = logTypeRegistry.getFunction('ulog');
const hasCorrectParams = ulogFunction && ulogFunction.parameters.length === 3;
const firstParamRequired = ulogFunction && !ulogFunction.parameters[0].optional;
const thirdParamOptional = ulogFunction && ulogFunction.parameters[2].optional;
testResult('Function parameter handling (ulog)', 
  hasCorrectParams && firstParamRequired && thirdParamOptional,
  `Param count: ${ulogFunction ? ulogFunction.parameters.length : 'N/A'}`);

// Test 5: Function identification
const isLogFunction = logTypeRegistry.isLogFunction('openlog');
const isNotLogFunction = !logTypeRegistry.isLogFunction('nonexistent');
testResult('Function identification', isLogFunction && isNotLogFunction,
  `openlog detected: ${isLogFunction}, nonexistent rejected: ${isNotLogFunction}`);

// Test 6: Return type handling
const closelogFunction = logTypeRegistry.getFunction('closelog');
const hasNullReturn = closelogFunction && closelogFunction.returnType === 'null';
const syslogFunction = logTypeRegistry.getFunction('syslog');
const hasBooleanReturn = syslogFunction && syslogFunction.returnType === 'boolean';
testResult('Return type handling', hasNullReturn && hasBooleanReturn,
  `closelog returns null: ${hasNullReturn}, syslog returns boolean: ${hasBooleanReturn}`);

// Test 7: Optional parameter handling
const openlogFunction = logTypeRegistry.getFunction('openlog');
const hasOptionalParams = openlogFunction && openlogFunction.parameters.every(p => p.optional);
const facilityHasDefault = openlogFunction && openlogFunction.parameters[2].defaultValue === 'user';
testResult('Optional parameter handling (openlog)', hasOptionalParams && facilityHasDefault,
  `All params optional: ${hasOptionalParams}, facility default: ${facilityHasDefault}`);

// Test 8: Complex type signatures
const ulogOpenSignature = logTypeRegistry.formatFunctionSignature('ulog_open');
const hasComplexTypes = ulogOpenSignature.includes('number | string | string[]');
testResult('Complex type signatures (ulog_open)', hasComplexTypes,
  `Signature: "${ulogOpenSignature}"`);

// Test 9: Convenience function handling
const convenienceFunctions = ['INFO', 'NOTE', 'WARN', 'ERR'];
const allConveniencePresent = convenienceFunctions.every(func => logTypeRegistry.isLogFunction(func));
const infoFunction = logTypeRegistry.getFunction('INFO');
const infoIsWrapper = infoFunction && infoFunction.description.includes('wrapper for ulog(LOG_INFO');
testResult('Convenience function handling', allConveniencePresent && infoIsWrapper,
  `All convenience functions present: ${allConveniencePresent}, INFO is wrapper: ${infoIsWrapper}`);

// Test 10: Documentation formatting consistency
const allFunctionsDocs = expectedFunctions.map(func => logTypeRegistry.getFunctionDocumentation(func));
const allHaveSignature = allFunctionsDocs.every(doc => doc.includes('**') && doc.includes('**'));
const allHaveReturns = allFunctionsDocs.every(doc => doc.includes('**Returns:**'));
testResult('Documentation formatting consistency', allHaveSignature && allHaveReturns,
  `All have signature formatting: ${allHaveSignature}, All have returns: ${allHaveReturns}`);

// Test 11: OpenWrt specific functions
const openWrtFunctions = ['ulog_open', 'ulog', 'ulog_close', 'ulog_threshold'];
const allOpenWrtPresent = openWrtFunctions.every(func => logTypeRegistry.isLogFunction(func));
const ulogSpecific = logTypeRegistry.getFunctionDocumentation('ulog');
const hasOpenWrtNote = ulogSpecific.includes('OpenWrt specific');
testResult('OpenWrt specific functions', allOpenWrtPresent && hasOpenWrtNote,
  `All OpenWrt functions present: ${allOpenWrtPresent}, Has OpenWrt note: ${hasOpenWrtNote}`);

// Test 12: Parameter type complexity
const ulogOpenFunction = logTypeRegistry.getFunction('ulog_open');
const channelsParam = ulogOpenFunction && ulogOpenFunction.parameters[0];
const hasComplexChannelType = channelsParam && channelsParam.type.includes('number | string | string[]');
testResult('Parameter type complexity', hasComplexChannelType,
  `Channels param type: ${channelsParam ? channelsParam.type : 'N/A'}`);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All tests passed! Log module type registry is working correctly.');
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed. Please check the implementation.`);
  process.exit(1);
}