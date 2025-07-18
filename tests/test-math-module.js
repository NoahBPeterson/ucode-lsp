// Test math module completion and hover functionality
console.log('🧮 Testing Math Module Functionality...\n');

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

// Expected math functions from math.c analysis
const expectedFunctions = [
  'abs', 'atan2', 'cos', 'exp', 'log', 'sin', 'sqrt', 'pow', 'rand', 'srand', 'isnan'
];

// Test 1: All expected functions are present
const foundFunctions = mathTypeRegistry.getFunctionNames();
const hasAllFunctions = expectedFunctions.every(func => foundFunctions.includes(func));
testResult('All expected functions present', hasAllFunctions,
  `Expected: ${expectedFunctions.length}, Found: ${foundFunctions.length}`);

// Test 2: Function signature formatting
const absSignature = mathTypeRegistry.formatFunctionSignature('abs');
const expectedAbsSignature = 'abs(number: number): number';
testResult('Function signature formatting', absSignature === expectedAbsSignature,
  `Expected: "${expectedAbsSignature}", Got: "${absSignature}"`);

// Test 3: Function documentation generation
const sinDoc = mathTypeRegistry.getFunctionDocumentation('sin');
const hasSinDoc = sinDoc && sinDoc.includes('sin(x: number): number') && sinDoc.includes('radians');
testResult('Function documentation generation', hasSinDoc,
  `Has documentation: ${!!sinDoc}`);

// Test 4: Function parameter handling
const powFunc = mathTypeRegistry.getFunction('pow');
const powParamsCorrect = powFunc && powFunc.parameters.length === 2 && 
  powFunc.parameters[0].name === 'x' && powFunc.parameters[1].name === 'y';
testResult('Function parameter handling', powParamsCorrect,
  `pow() parameters: ${powFunc ? powFunc.parameters.length : 'N/A'}`);

// Test 5: Function identification
const isSinFunction = mathTypeRegistry.isMathFunction('sin');
const isNotMathFunction = !mathTypeRegistry.isMathFunction('notAFunction');
testResult('Function identification', isSinFunction && isNotMathFunction,
  `sin is math function: ${isSinFunction}, notAFunction is not: ${isNotMathFunction}`);

// Test 6: Return type handling
const cosFunc = mathTypeRegistry.getFunction('cos');
const cosReturnType = cosFunc && cosFunc.returnType === 'number';
testResult('Return type handling', cosReturnType,
  `cos() return type: ${cosFunc ? cosFunc.returnType : 'N/A'}`);

// Test 7: Functions with no parameters
const randFunc = mathTypeRegistry.getFunction('rand');
const randNoParams = randFunc && randFunc.parameters.length === 0;
testResult('Functions with no parameters', randNoParams,
  `rand() parameters: ${randFunc ? randFunc.parameters.length : 'N/A'}`);

// Test 8: Functions with multiple parameters
const atan2Func = mathTypeRegistry.getFunction('atan2');
const atan2TwoParams = atan2Func && atan2Func.parameters.length === 2;
testResult('Functions with multiple parameters', atan2TwoParams,
  `atan2() parameters: ${atan2Func ? atan2Func.parameters.length : 'N/A'}`);

// Test 9: Import validation methods
const validImport = mathTypeRegistry.isValidMathImport('abs');
const invalidImport = !mathTypeRegistry.isValidMathImport('invalidFunction');
testResult('Import validation methods', validImport && invalidImport,
  `abs is valid: ${validImport}, invalidFunction is not: ${invalidImport}`);

// Test 10: Valid imports list
const validImports = mathTypeRegistry.getValidMathImports();
const validImportsCorrect = validImports.length === expectedFunctions.length &&
  expectedFunctions.every(func => validImports.includes(func));
testResult('Valid imports list', validImportsCorrect,
  `Valid imports: ${validImports.length}, Expected: ${expectedFunctions.length}`);

// Test 11: Function descriptions contain key information
const logDoc = mathTypeRegistry.getFunctionDocumentation('log');
const logDocComplete = logDoc && logDoc.includes('natural logarithm') && logDoc.includes('Returns:');
testResult('Function descriptions complete', logDocComplete,
  `log() documentation has required info: ${logDocComplete}`);

// Test 12: Complex mathematical function (atan2)
const atan2Doc = mathTypeRegistry.getFunctionDocumentation('atan2');
const atan2DocComplete = atan2Doc && atan2Doc.includes('arc tangent') && atan2Doc.includes('y') && atan2Doc.includes('x');
testResult('Complex mathematical function documentation', atan2DocComplete,
  `atan2() documentation has required info: ${atan2DocComplete}`);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All math module tests passed!');
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed. Please check the implementation.`);
  process.exit(1);
}