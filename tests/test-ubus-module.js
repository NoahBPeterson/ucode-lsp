// Test suite for ubus module completion and hover functionality
console.log('🔧 Running ubus Module Tests...\n');

const { ubusTypeRegistry } = require('../src/analysis/ubusTypes');

const expectedFunctions = [
  'error', 'connect', 'open_channel', 'guard'
];

const expectedConstants = [
  'STATUS_OK', 'STATUS_INVALID_COMMAND', 'STATUS_INVALID_ARGUMENT',
  'STATUS_METHOD_NOT_FOUND', 'STATUS_NOT_FOUND', 'STATUS_NO_DATA',
  'STATUS_PERMISSION_DENIED', 'STATUS_TIMEOUT', 'STATUS_NOT_SUPPORTED',
  'STATUS_UNKNOWN_ERROR', 'STATUS_CONNECTION_FAILED', 'STATUS_NO_MEMORY',
  'STATUS_PARSE_ERROR', 'STATUS_SYSTEM_ERROR', 'STATUS_CONTINUE',
  'SYSTEM_OBJECT_ACL'
];

let totalTests = 0;
let passedTests = 0;

function test(name, condition) {
  totalTests++;
  const result = condition();
  console.log(`  ${result ? '✅' : '❌'} ${name}`);
  if (result) passedTests++;
  return result;
}

// Test 1: All expected functions are present
console.log('🧪 Testing function registry:');
for (const funcName of expectedFunctions) {
  test(`Function '${funcName}' is registered`, () => 
    ubusTypeRegistry.isUbusFunction(funcName)
  );
}

// Test 2: All expected constants are present
console.log('\n🧪 Testing constant registry:');
for (const constName of expectedConstants) {
  test(`Constant '${constName}' is registered`, () => 
    ubusTypeRegistry.isUbusConstant(constName)
  );
}

// Test 3: Function signature formatting
console.log('\n🧪 Testing function signatures:');
test('connect() signature is formatted correctly', () => {
  const sig = ubusTypeRegistry.formatFunctionSignature('connect');
  return sig.includes('connect(') && sig.includes('object');
});

test('error() signature is formatted correctly', () => {
  const sig = ubusTypeRegistry.formatFunctionSignature('error');
  return sig.includes('error(') && sig.includes('integer | string | null');
});

test('open_channel() signature is formatted correctly', () => {
  const sig = ubusTypeRegistry.formatFunctionSignature('open_channel');
  return sig.includes('open_channel(') && sig.includes('fd: integer') && sig.includes('object');
});

test('guard() signature is formatted correctly', () => {
  const sig = ubusTypeRegistry.formatFunctionSignature('guard');
  return sig.includes('guard(') && sig.includes('function | boolean');
});

// Test 4: Function documentation generation
console.log('\n🧪 Testing function documentation:');
test('connect() documentation includes parameters', () => {
  const doc = ubusTypeRegistry.getFunctionDocumentation('connect');
  return doc.includes('Parameters:') && doc.includes('socket') && doc.includes('timeout');
});

test('error() documentation includes return type', () => {
  const doc = ubusTypeRegistry.getFunctionDocumentation('error');
  return doc.includes('Returns:') && doc.includes('integer | string | null');
});

test('open_channel() documentation includes examples', () => {
  const doc = ubusTypeRegistry.getFunctionDocumentation('open_channel');
  return doc.includes('Example:') && doc.includes('open_channel');
});

test('guard() documentation includes description', () => {
  const doc = ubusTypeRegistry.getFunctionDocumentation('guard');
  return doc.includes('exception handler') && doc.includes('function');
});

// Test 5: Constant documentation generation
console.log('\n🧪 Testing constant documentation:');
test('STATUS_OK constant documentation is correct', () => {
  const doc = ubusTypeRegistry.getConstantDocumentation('STATUS_OK');
  return doc.includes('STATUS_OK') && doc.includes('= `0`') && doc.includes('successfully');
});

test('STATUS_INVALID_ARGUMENT constant documentation is correct', () => {
  const doc = ubusTypeRegistry.getConstantDocumentation('STATUS_INVALID_ARGUMENT');
  return doc.includes('STATUS_INVALID_ARGUMENT') && doc.includes('= `2`') && doc.includes('Invalid argument');
});

test('STATUS_TIMEOUT constant documentation is correct', () => {
  const doc = ubusTypeRegistry.getConstantDocumentation('STATUS_TIMEOUT');
  return doc.includes('STATUS_TIMEOUT') && doc.includes('= `7`') && doc.includes('timed out');
});

// Test 6: Function parameter handling
console.log('\n🧪 Testing parameter handling:');
test('connect() has optional parameters', () => {
  const func = ubusTypeRegistry.getFunction('connect');
  return func && func.parameters.some(p => p.optional);
});

test('error() has optional numeric parameter', () => {
  const func = ubusTypeRegistry.getFunction('error');
  return func && func.parameters.length === 1 && func.parameters[0].optional;
});

test('open_channel() has required fd parameter', () => {
  const func = ubusTypeRegistry.getFunction('open_channel');
  return func && func.parameters.some(p => p.name === 'fd' && !p.optional);
});

// Test 7: Function identification
console.log('\n🧪 Testing function identification:');
test('Valid function names are identified correctly', () => {
  return expectedFunctions.every(name => ubusTypeRegistry.isUbusFunction(name));
});

test('Invalid function names are rejected', () => {
  const invalidNames = ['invalid_func', 'notAFunction', 'connect_invalid'];
  return invalidNames.every(name => !ubusTypeRegistry.isUbusFunction(name));
});

// Test 8: Constant identification
console.log('\n🧪 Testing constant identification:');
test('Valid constant names are identified correctly', () => {
  return expectedConstants.every(name => ubusTypeRegistry.isUbusConstant(name));
});

test('Invalid constant names are rejected', () => {
  const invalidNames = ['INVALID_STATUS', 'NOT_A_CONSTANT', 'STATUS_FAKE'];
  return invalidNames.every(name => !ubusTypeRegistry.isUbusConstant(name));
});

// Test 9: Import validation
console.log('\n🧪 Testing import validation:');
test('Valid imports are accepted', () => {
  const validImports = [...expectedFunctions, ...expectedConstants];
  return validImports.every(name => ubusTypeRegistry.isValidImport(name));
});

test('Invalid imports are rejected', () => {
  const invalidImports = ['invalidFunction', 'INVALID_CONSTANT', 'notExported'];
  return invalidImports.every(name => !ubusTypeRegistry.isValidImport(name));
});

test('getValidImports() returns all expected exports', () => {
  const validImports = ubusTypeRegistry.getValidImports();
  const allExpected = [...expectedFunctions, ...expectedConstants];
  return allExpected.every(name => validImports.includes(name)) &&
         validImports.length >= allExpected.length;
});

// Test 10: Return type handling
console.log('\n🧪 Testing return types:');
test('connect() returns object type', () => {
  const func = ubusTypeRegistry.getFunction('connect');
  return func && func.returnType === 'object';
});

test('error() returns union type', () => {
  const func = ubusTypeRegistry.getFunction('error');
  return func && func.returnType.includes('integer') && func.returnType.includes('string') && func.returnType.includes('null');
});

test('guard() returns function or boolean', () => {
  const func = ubusTypeRegistry.getFunction('guard');
  return func && func.returnType.includes('function') && func.returnType.includes('boolean');
});

// Test 11: Integration with registry system
console.log('\n🧪 Testing registry integration:');
test('getFunctionNames() returns all expected functions', () => {
  const functionNames = ubusTypeRegistry.getFunctionNames();
  return expectedFunctions.every(name => functionNames.includes(name));
});

test('getConstantNames() returns all expected constants', () => {
  const constantNames = ubusTypeRegistry.getConstantNames();
  return expectedConstants.every(name => constantNames.includes(name));
});

test('getFunction() returns valid function objects', () => {
  return expectedFunctions.every(name => {
    const func = ubusTypeRegistry.getFunction(name);
    return func && func.name === name && Array.isArray(func.parameters);
  });
});

test('getConstant() returns valid constant objects', () => {
  return expectedConstants.every(name => {
    const constant = ubusTypeRegistry.getConstant(name);
    return constant && constant.name === name && typeof constant.value !== 'undefined';
  });
});

// Summary
console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All ubus module tests passed!');
  process.exit(0);
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed`);
  process.exit(1);
}