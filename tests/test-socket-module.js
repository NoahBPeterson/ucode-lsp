// Test suite for socket module completion and hover functionality
console.log('🔧 Running Socket Module Tests...\n');

const fs = require('fs');
const path = require('path');
const { socketTypeRegistry } = require('../src/analysis/socketTypes');

const expectedFunctions = [
  'create', 'connect', 'listen', 'sockaddr', 'nameinfo', 'addrinfo', 'poll', 'error', 'strerror'
];

function readExpectedConstants() {
  const socketSourcePath = path.join(__dirname, '..', 'ucode', 'lib', 'socket.c');
  const source = fs.readFileSync(socketSourcePath, 'utf8');
  const regex = /ADD_CONST_IF\(([^)]+)\);/g;
  const names = new Set();
  let match;

  while ((match = regex.exec(source)) !== null) {
    names.add(match[1]);
  }

  return Array.from(names).sort();
}

const expectedConstants = readExpectedConstants();

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

// Test 1: All expected functions are present
testCase("All expected functions are present", () => {
  const actualFunctions = socketTypeRegistry.getFunctionNames();
  const missing = expectedFunctions.filter(name => !actualFunctions.includes(name));
  if (missing.length > 0) {
    console.log(`    Missing functions: ${missing.join(', ')}`);
    return false;
  }
  console.log(`    Found all ${expectedFunctions.length} expected functions`);
  return true;
});

// Test 2: All expected constants are present
testCase("All expected constants are present", () => {
  const actualConstants = socketTypeRegistry.getConstantNames();
  const missing = expectedConstants.filter(name => !actualConstants.includes(name));
  const unexpected = actualConstants.filter(name => !expectedConstants.includes(name));
  if (missing.length > 0) {
    console.log(`    Missing constants: ${missing.join(', ')}`);
    return false;
  }
  if (unexpected.length > 0) {
    console.log(`    Unexpected constants: ${unexpected.join(', ')}`);
    return false;
  }
  console.log(`    Found all ${expectedConstants.length} expected constants`);
  return true;
});

// Test 3: Function signature formatting
testCase("Function signature formatting", () => {
  const createSig = socketTypeRegistry.formatFunctionSignature('create');
  const expectedSig = 'create([domain: number] = AF_INET, [type: number] = SOCK_STREAM, [protocol: number] = 0): socket | null';
  if (createSig !== expectedSig) {
    console.log(`    Expected: ${expectedSig}`);
    console.log(`    Actual: ${createSig}`);
    return false;
  }
  console.log(`    Signature formatted correctly`);
  return true;
});

// Test 4: Function documentation generation
testCase("Function documentation generation", () => {
  const createDoc = socketTypeRegistry.getFunctionDocumentation('create');
  if (!createDoc.includes('Creates a network socket instance') || 
      !createDoc.includes('**Parameters:**') || 
      !createDoc.includes('**Returns:**')) {
    console.log(`    Documentation incomplete or malformed`);
    return false;
  }
  console.log(`    Documentation generated correctly`);
  return true;
});

// Test 5: Constant documentation generation
testCase("Constant documentation generation", () => {
  const afInetDoc = socketTypeRegistry.getConstantDocumentation('AF_INET');
  if (!afInetDoc.includes('AF_INET') || 
      !afInetDoc.includes('IPv4 Internet protocols') ||
      !afInetDoc.includes('number')) {
    console.log(`    Constant documentation incomplete or malformed`);
    return false;
  }
  console.log(`    Constant documentation generated correctly`);
  return true;
});

// Test 6: Function parameter handling
testCase("Function parameter handling", () => {
  const connectFunc = socketTypeRegistry.getFunction('connect');
  if (!connectFunc || connectFunc.parameters.length < 3) {
    console.log(`    Connect function not found or has wrong parameter count`);
    return false;
  }
  
  const hostParam = connectFunc.parameters[0];
  if (hostParam.name !== 'host' || hostParam.optional !== false) {
    console.log(`    Host parameter incorrect`);
    return false;
  }
  
  const serviceParam = connectFunc.parameters[1];
  if (serviceParam.name !== 'service' || serviceParam.optional !== true) {
    console.log(`    Service parameter incorrect`);
    return false;
  }
  
  console.log(`    Parameters handled correctly`);
  return true;
});

// Test 7: Function identification
testCase("Function identification", () => {
  if (!socketTypeRegistry.isSocketFunction('create') || 
      !socketTypeRegistry.isSocketFunction('connect') ||
      socketTypeRegistry.isSocketFunction('nonexistent')) {
    console.log(`    Function identification incorrect`);
    return false;
  }
  console.log(`    Function identification working correctly`);
  return true;
});

// Test 8: Constant identification
testCase("Constant identification", () => {
  if (!socketTypeRegistry.isSocketConstant('AF_INET') || 
      !socketTypeRegistry.isSocketConstant('SOCK_STREAM') ||
      socketTypeRegistry.isSocketConstant('NONEXISTENT_CONST')) {
    console.log(`    Constant identification incorrect`);
    return false;
  }
  console.log(`    Constant identification working correctly`);
  return true;
});

// Test 9: Return type handling
testCase("Return type handling", () => {
  const createFunc = socketTypeRegistry.getFunction('create');
  if (!createFunc || createFunc.returnType !== 'socket | null') {
    console.log(`    Return type incorrect for create function`);
    return false;
  }
  
  const errorFunc = socketTypeRegistry.getFunction('error');
  if (!errorFunc || errorFunc.returnType !== 'string | number | null') {
    console.log(`    Return type incorrect for error function`);
    return false;
  }
  
  console.log(`    Return types handled correctly`);
  return true;
});

// Test 10: Import validation
testCase("Import validation", () => {
  const validImports = socketTypeRegistry.getValidImports();
  
  if (!socketTypeRegistry.isValidImport('create') ||
      !socketTypeRegistry.isValidImport('AF_INET') ||
      socketTypeRegistry.isValidImport('invalid_import')) {
    console.log(`    Import validation incorrect`);
    return false;
  }
  
  if (validImports.length !== expectedFunctions.length + expectedConstants.length) {
    console.log(`    Valid imports count mismatch`);
    return false;
  }
  
  console.log(`    Import validation working correctly`);
  return true;
});

// Test 11: Optional parameter handling with defaults
testCase("Optional parameter handling with defaults", () => {
  const listenFunc = socketTypeRegistry.getFunction('listen');
  if (!listenFunc) {
    console.log(`    Listen function not found`);
    return false;
  }
  
  const backlogParam = listenFunc.parameters.find(p => p.name === 'backlog');
  if (!backlogParam || !backlogParam.optional || backlogParam.defaultValue !== 128) {
    console.log(`    Backlog parameter default value incorrect`);
    return false;
  }
  
  console.log(`    Optional parameters with defaults handled correctly`);
  return true;
});

// Test 12: Complex type signatures
testCase("Complex type signatures", () => {
  const connectFunc = socketTypeRegistry.getFunction('connect');
  if (!connectFunc) {
    console.log(`    Connect function not found`);
    return false;
  }
  
  const hostParam = connectFunc.parameters[0];
  if (!hostParam.type.includes('string | number[] | SocketAddress')) {
    console.log(`    Complex type signature not handled correctly`);
    return false;
  }
  
  console.log(`    Complex type signatures handled correctly`);
  return true;
});

// Test 13: Mock completion integration test
testCase("Mock completion integration test", () => {
  // Simulate what completion system would do
  const functionNames = socketTypeRegistry.getFunctionNames();
  const constantNames = socketTypeRegistry.getConstantNames();
  
  if (functionNames.includes('create') && constantNames.includes('AF_INET')) {
    console.log(`    Mock completion integration successful`);
    return true;
  } else {
    console.log(`    Mock completion integration failed`);
    return false;
  }
});

// Test 14: Documentation formatting consistency
testCase("Documentation formatting consistency", () => {
  const createDoc = socketTypeRegistry.getFunctionDocumentation('create');
  const connectDoc = socketTypeRegistry.getFunctionDocumentation('connect');
  
  // Both should have consistent structure
  if (!createDoc.includes('**') || !connectDoc.includes('**') ||
      !createDoc.includes('**Parameters:**') || !connectDoc.includes('**Parameters:**') ||
      !createDoc.includes('**Returns:**') || !connectDoc.includes('**Returns:**')) {
    console.log(`    Documentation formatting inconsistent`);
    return false;
  }
  
  console.log(`    Documentation formatting is consistent`);
  return true;
});

// Test 15: Constant value types
testCase("Constant value types", () => {
  const afInet = socketTypeRegistry.getConstant('AF_INET');
  const sockStream = socketTypeRegistry.getConstant('SOCK_STREAM');
  
  if (!afInet || typeof afInet.value !== 'number' || afInet.type !== 'number') {
    console.log(`    AF_INET constant value/type incorrect`);
    return false;
  }
  
  if (!sockStream || typeof sockStream.value !== 'number' || sockStream.type !== 'number') {
    console.log(`    SOCK_STREAM constant value/type incorrect`);
    return false;
  }
  
  console.log(`    Constant value types are correct`);
  return true;
});

console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed`);
