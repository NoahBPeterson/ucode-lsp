// Test suite for zlib module completion and hover functionality
console.log('🔧 Running Zlib Module Tests...\n');

const { zlibTypeRegistry } = require('../src/analysis/zlibTypes');

const expectedFunctions = [
  'deflate', 'inflate', 'deflater', 'inflater'
];

const expectedConstants = [
  'Z_NO_COMPRESSION', 'Z_BEST_SPEED', 'Z_BEST_COMPRESSION', 'Z_DEFAULT_COMPRESSION',
  'Z_NO_FLUSH', 'Z_PARTIAL_FLUSH', 'Z_SYNC_FLUSH', 'Z_FULL_FLUSH', 'Z_FINISH'
];

let totalTests = 0;
let passedTests = 0;

function runTest(testName, testFunction) {
  totalTests++;
  console.log(`🧪 Testing ${testName}:`);
  
  try {
    const result = testFunction();
    if (result) {
      console.log(`  ✅ PASS`);
      passedTests++;
      return true;
    } else {
      console.log(`  ❌ FAIL`);
      return false;
    }
  } catch (error) {
    console.log(`  ❌ FAIL - ${error.message}`);
    return false;
  }
}

// Test 1: All expected functions are present
runTest('All expected functions are present', () => {
  const actualFunctions = zlibTypeRegistry.getFunctionNames();
  
  for (const expectedFunction of expectedFunctions) {
    if (!actualFunctions.includes(expectedFunction)) {
      throw new Error(`Missing function: ${expectedFunction}`);
    }
  }
  
  console.log(`    Found ${actualFunctions.length} functions: ${actualFunctions.join(', ')}`);
  return true;
});

// Test 2: All expected constants are present
runTest('All expected constants are present', () => {
  const actualConstants = zlibTypeRegistry.getConstantNames();
  
  for (const expectedConstant of expectedConstants) {
    if (!actualConstants.includes(expectedConstant)) {
      throw new Error(`Missing constant: ${expectedConstant}`);
    }
  }
  
  console.log(`    Found ${actualConstants.length} constants: ${actualConstants.join(', ')}`);
  return true;
});

// Test 3: Function signature formatting
runTest('Function signature formatting', () => {
  const deflateSignature = zlibTypeRegistry.formatFunctionSignature('deflate');
  const inflateSignature = zlibTypeRegistry.formatFunctionSignature('inflate');
  const deflaterSignature = zlibTypeRegistry.formatFunctionSignature('deflater');
  const inflaterSignature = zlibTypeRegistry.formatFunctionSignature('inflater');
  
  if (!deflateSignature.includes('deflate(') || !deflateSignature.includes('string | null')) {
    throw new Error(`Invalid deflate signature: ${deflateSignature}`);
  }
  
  if (!inflateSignature.includes('inflate(') || !inflateSignature.includes('string | null')) {
    throw new Error(`Invalid inflate signature: ${inflateSignature}`);
  }
  
  if (!deflaterSignature.includes('deflater(') || !deflaterSignature.includes('zlib.deflate | null')) {
    throw new Error(`Invalid deflater signature: ${deflaterSignature}`);
  }
  
  if (!inflaterSignature.includes('inflater(') || !inflaterSignature.includes('zlib.inflate | null')) {
    throw new Error(`Invalid inflater signature: ${inflaterSignature}`);
  }
  
  console.log(`    deflate: ${deflateSignature}`);
  console.log(`    inflate: ${inflateSignature}`);
  return true;
});

// Test 4: Function documentation generation
runTest('Function documentation generation', () => {
  for (const functionName of expectedFunctions) {
    const doc = zlibTypeRegistry.getFunctionDocumentation(functionName);
    
    if (!doc || doc.length < 50) {
      throw new Error(`Invalid documentation for ${functionName}: too short`);
    }
    
    if (!doc.includes('**Parameters:**') && functionName !== 'inflater') {
      throw new Error(`Missing parameters section for ${functionName}`);
    }
    
    if (!doc.includes('**Returns:**')) {
      throw new Error(`Missing returns section for ${functionName}`);
    }
    
    if (!doc.includes('**Example:**') && functionName !== 'inflater') {
      throw new Error(`Missing example section for ${functionName}`);
    }
  }
  
  console.log(`    Generated documentation for all ${expectedFunctions.length} functions`);
  return true;
});

// Test 5: Constant documentation generation
runTest('Constant documentation generation', () => {
  for (const constantName of expectedConstants) {
    const doc = zlibTypeRegistry.getConstantDocumentation(constantName);
    
    if (!doc || doc.length < 20) {
      throw new Error(`Invalid documentation for ${constantName}: too short`);
    }
    
    if (!doc.includes(constantName)) {
      throw new Error(`Missing constant name in documentation for ${constantName}`);
    }
    
    if (!doc.includes('*number*')) {
      throw new Error(`Missing type information for ${constantName}`);
    }
  }
  
  console.log(`    Generated documentation for all ${expectedConstants.length} constants`);
  return true;
});

// Test 6: Function parameter handling
runTest('Function parameter handling', () => {
  const deflateFunc = zlibTypeRegistry.getFunction('deflate');
  const inflateFunc = zlibTypeRegistry.getFunction('inflate');
  const deflaterFunc = zlibTypeRegistry.getFunction('deflater');
  const inflaterFunc = zlibTypeRegistry.getFunction('inflater');
  
  // deflate should have 3 parameters: str_or_resource (required), gzip (optional), level (optional)
  if (deflateFunc.parameters.length !== 3) {
    throw new Error(`deflate should have 3 parameters, got ${deflateFunc.parameters.length}`);
  }
  
  if (deflateFunc.parameters[0].optional) {
    throw new Error('deflate first parameter (str_or_resource) should be required');
  }
  
  if (!deflateFunc.parameters[1].optional || !deflateFunc.parameters[2].optional) {
    throw new Error('deflate second and third parameters should be optional');
  }
  
  // inflate should have 1 parameter: str_or_resource (required)
  if (inflateFunc.parameters.length !== 1) {
    throw new Error(`inflate should have 1 parameter, got ${inflateFunc.parameters.length}`);
  }
  
  if (inflateFunc.parameters[0].optional) {
    throw new Error('inflate parameter should be required');
  }
  
  // inflater should have 0 parameters
  if (inflaterFunc.parameters.length !== 0) {
    throw new Error(`inflater should have 0 parameters, got ${inflaterFunc.parameters.length}`);
  }
  
  console.log(`    Parameter validation passed for all functions`);
  return true;
});

// Test 7: Function identification
runTest('Function identification', () => {
  // Test valid functions
  for (const functionName of expectedFunctions) {
    if (!zlibTypeRegistry.isZlibFunction(functionName)) {
      throw new Error(`${functionName} should be identified as zlib function`);
    }
  }
  
  // Test invalid functions
  const invalidFunctions = ['compress', 'decompress', 'gzip', 'gunzip', 'invalid'];
  for (const invalidFunction of invalidFunctions) {
    if (zlibTypeRegistry.isZlibFunction(invalidFunction)) {
      throw new Error(`${invalidFunction} should not be identified as zlib function`);
    }
  }
  
  console.log(`    Function identification working correctly`);
  return true;
});

// Test 8: Constant identification
runTest('Constant identification', () => {
  // Test valid constants
  for (const constantName of expectedConstants) {
    if (!zlibTypeRegistry.isZlibConstant(constantName)) {
      throw new Error(`${constantName} should be identified as zlib constant`);
    }
  }
  
  // Test invalid constants
  const invalidConstants = ['ZLIB_VERSION', 'DEFLATE_LEVEL', 'COMPRESS_FAST', 'invalid'];
  for (const invalidConstant of invalidConstants) {
    if (zlibTypeRegistry.isZlibConstant(invalidConstant)) {
      throw new Error(`${invalidConstant} should not be identified as zlib constant`);
    }
  }
  
  console.log(`    Constant identification working correctly`);
  return true;
});

// Test 9: Return type handling
runTest('Return type handling', () => {
  const deflateFunc = zlibTypeRegistry.getFunction('deflate');
  const inflateFunc = zlibTypeRegistry.getFunction('inflate');
  const deflaterFunc = zlibTypeRegistry.getFunction('deflater');
  const inflaterFunc = zlibTypeRegistry.getFunction('inflater');
  
  if (deflateFunc.returnType !== 'string | null') {
    throw new Error(`deflate return type should be 'string | null', got '${deflateFunc.returnType}'`);
  }
  
  if (inflateFunc.returnType !== 'string | null') {
    throw new Error(`inflate return type should be 'string | null', got '${inflateFunc.returnType}'`);
  }
  
  if (deflaterFunc.returnType !== 'zlib.deflate | null') {
    throw new Error(`deflater return type should be 'zlib.deflate | null', got '${deflaterFunc.returnType}'`);
  }
  
  if (inflaterFunc.returnType !== 'zlib.inflate | null') {
    throw new Error(`inflater return type should be 'zlib.inflate | null', got '${inflaterFunc.returnType}'`);
  }
  
  console.log(`    Return type validation passed for all functions`);
  return true;
});

// Test 10: Import validation
runTest('Import validation', () => {
  // Test valid imports
  const validImports = [...expectedFunctions, ...expectedConstants];
  for (const validImport of validImports) {
    if (!zlibTypeRegistry.isValidImport(validImport)) {
      throw new Error(`${validImport} should be a valid import`);
    }
  }
  
  // Test invalid imports
  const invalidImports = ['compress', 'decompress', 'gzip', 'INVALID_CONST', 'nonexistent'];
  for (const invalidImport of invalidImports) {
    if (zlibTypeRegistry.isValidImport(invalidImport)) {
      throw new Error(`${invalidImport} should not be a valid import`);
    }
  }
  
  const allValidImports = zlibTypeRegistry.getValidImports();
  const expectedTotal = expectedFunctions.length + expectedConstants.length;
  if (allValidImports.length !== expectedTotal) {
    throw new Error(`Should have ${expectedTotal} valid imports, got ${allValidImports.length}`);
  }
  
  console.log(`    Import validation working correctly (${allValidImports.length} valid imports)`);
  return true;
});

// Test 11: Complex type signatures
runTest('Complex type signatures', () => {
  const deflateFunc = zlibTypeRegistry.getFunction('deflate');
  
  // Check parameter types
  if (deflateFunc.parameters[0].type !== 'string | object') {
    throw new Error(`deflate first parameter should be 'string | object', got '${deflateFunc.parameters[0].type}'`);
  }
  
  if (deflateFunc.parameters[1].type !== 'boolean') {
    throw new Error(`deflate second parameter should be 'boolean', got '${deflateFunc.parameters[1].type}'`);
  }
  
  if (deflateFunc.parameters[2].type !== 'number') {
    throw new Error(`deflate third parameter should be 'number', got '${deflateFunc.parameters[2].type}'`);
  }
  
  // Check default values
  if (deflateFunc.parameters[1].defaultValue !== false) {
    throw new Error(`deflate gzip parameter default should be false, got '${deflateFunc.parameters[1].defaultValue}'`);
  }
  
  if (deflateFunc.parameters[2].defaultValue !== 'Z_DEFAULT_COMPRESSION') {
    throw new Error(`deflate level parameter default should be 'Z_DEFAULT_COMPRESSION', got '${deflateFunc.parameters[2].defaultValue}'`);
  }
  
  console.log(`    Complex type signature validation passed`);
  return true;
});

// Test 12: Mock completion integration test
runTest('Mock completion integration test', () => {
  // Simulate what the completion system would do
  const functions = zlibTypeRegistry.getFunctionNames();
  const constants = zlibTypeRegistry.getConstantNames();
  
  let completionItems = [];
  
  // Add function completions
  for (const functionName of functions) {
    const signature = zlibTypeRegistry.getFunction(functionName);
    if (signature) {
      completionItems.push({
        label: functionName,
        kind: 'Function',
        detail: 'zlib module function',
        documentation: zlibTypeRegistry.getFunctionDocumentation(functionName)
      });
    }
  }
  
  // Add constant completions
  for (const constantName of constants) {
    const constant = zlibTypeRegistry.getConstant(constantName);
    if (constant) {
      completionItems.push({
        label: constantName,
        kind: 'Constant',
        detail: `zlib constant: ${constant.type}`,
        documentation: zlibTypeRegistry.getConstantDocumentation(constantName)
      });
    }
  }
  
  const expectedTotal = expectedFunctions.length + expectedConstants.length;
  if (completionItems.length !== expectedTotal) {
    throw new Error(`Should have ${expectedTotal} completion items, got ${completionItems.length}`);
  }
  
  // Verify all items have required properties
  for (const item of completionItems) {
    if (!item.label || !item.kind || !item.detail || !item.documentation) {
      throw new Error(`Incomplete completion item: ${JSON.stringify(item)}`);
    }
  }
  
  console.log(`    Mock completion integration test passed (${completionItems.length} items)`);
  return true;
});

// Test 13: Documentation formatting
runTest('Documentation formatting', () => {
  const deflateDoc = zlibTypeRegistry.getFunctionDocumentation('deflate');
  const z_best_speedDoc = zlibTypeRegistry.getConstantDocumentation('Z_BEST_SPEED');
  
  // Check markdown formatting
  if (!deflateDoc.includes('**deflate(') || !deflateDoc.includes('**Parameters:**') || !deflateDoc.includes('**Returns:**')) {
    throw new Error('deflate documentation missing proper markdown formatting');
  }
  
  if (!z_best_speedDoc.includes('**Z_BEST_SPEED**') || !z_best_speedDoc.includes('*number*')) {
    throw new Error('Z_BEST_SPEED documentation missing proper markdown formatting');
  }
  
  // Check code examples
  if (!deflateDoc.includes('```ucode\n') || !deflateDoc.includes('\n```')) {
    throw new Error('deflate documentation missing code examples');
  }
  
  console.log(`    Documentation formatting validation passed`);
  return true;
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All zlib module tests passed!');
  process.exit(0);
} else {
  console.log(`❌ ${totalTests - passedTests} test(s) failed`);
  process.exit(1);
}