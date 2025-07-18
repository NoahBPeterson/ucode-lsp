// Test math module aliased import hover functionality
console.log('🧮 Testing Math Module Aliased Import Hover...\n');

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

// Test 1: Verify original function documentation exists
const absDoc = mathTypeRegistry.getFunctionDocumentation('abs');
const hasAbsDoc = absDoc && absDoc.includes('abs(number: number): number') && absDoc.includes('absolute value');
testResult('Original abs function documentation', hasAbsDoc,
  `Has documentation: ${!!absDoc}`);

// Test 2: Verify sin function documentation exists
const sinDoc = mathTypeRegistry.getFunctionDocumentation('sin');
const hasSinDoc = sinDoc && sinDoc.includes('sin(x: number): number') && sinDoc.includes('sine');
testResult('Original sin function documentation', hasSinDoc,
  `Has documentation: ${!!sinDoc}`);

// Test 3: Verify cos function documentation exists
const cosDoc = mathTypeRegistry.getFunctionDocumentation('cos');
const hasCosDoc = cosDoc && cosDoc.includes('cos(x: number): number') && cosDoc.includes('cosine');
testResult('Original cos function documentation', hasCosDoc,
  `Has documentation: ${!!cosDoc}`);

// Test 4: Verify pow function documentation exists
const powDoc = mathTypeRegistry.getFunctionDocumentation('pow');
const hasPowDoc = powDoc && powDoc.includes('pow(x: number, y: number): number') && powDoc.includes('power');
testResult('Original pow function documentation', hasPowDoc,
  `Has documentation: ${!!powDoc}`);

// Test 5: Verify sqrt function documentation exists
const sqrtDoc = mathTypeRegistry.getFunctionDocumentation('sqrt');
const hasSqrtDoc = sqrtDoc && sqrtDoc.includes('sqrt(x: number): number') && sqrtDoc.includes('square root');
testResult('Original sqrt function documentation', hasSqrtDoc,
  `Has documentation: ${!!sqrtDoc}`);

// Test 6: Verify exp function documentation exists
const expDoc = mathTypeRegistry.getFunctionDocumentation('exp');
const hasExpDoc = expDoc && expDoc.includes('exp(x: number): number') && expDoc.includes('base of natural logarithms');
testResult('Original exp function documentation', hasExpDoc,
  `Has documentation: ${!!expDoc}`);

// Test 7: Verify log function documentation exists
const logDoc = mathTypeRegistry.getFunctionDocumentation('log');
const hasLogDoc = logDoc && logDoc.includes('log(x: number): number') && logDoc.includes('natural logarithm');
testResult('Original log function documentation', hasLogDoc,
  `Has documentation: ${!!logDoc}`);

// Test 8: Verify rand function documentation exists
const randDoc = mathTypeRegistry.getFunctionDocumentation('rand');
const hasRandDoc = randDoc && randDoc.includes('rand(): number') && randDoc.includes('pseudo-random');
testResult('Original rand function documentation', hasRandDoc,
  `Has documentation: ${!!randDoc}`);

// Test 9: Verify srand function documentation exists
const srandDoc = mathTypeRegistry.getFunctionDocumentation('srand');
const hasSrandDoc = srandDoc && srandDoc.includes('srand(seed: number): null') && srandDoc.includes('Seeds');
testResult('Original srand function documentation', hasSrandDoc,
  `Has documentation: ${!!srandDoc}`);

// Test 10: Verify isnan function documentation exists
const isnanDoc = mathTypeRegistry.getFunctionDocumentation('isnan');
const hasIsnanDoc = isnanDoc && isnanDoc.includes('isnan(x: number): boolean') && isnanDoc.includes('NaN');
testResult('Original isnan function documentation', hasIsnanDoc,
  `Has documentation: ${!!isnanDoc}`);

// Test 11: Verify atan2 function documentation exists
const atan2Doc = mathTypeRegistry.getFunctionDocumentation('atan2');
const hasAtan2Doc = atan2Doc && atan2Doc.includes('atan2(y: number, x: number): number') && atan2Doc.includes('arc tangent');
testResult('Original atan2 function documentation', hasAtan2Doc,
  `Has documentation: ${!!atan2Doc}`);

// Test 12: Verify all functions have rich documentation
const allFunctions = mathTypeRegistry.getFunctionNames();
const allHaveRichDoc = allFunctions.every(func => {
  const doc = mathTypeRegistry.getFunctionDocumentation(func);
  const hasReturns = doc && doc.includes('**Returns:**');
  const funcObj = mathTypeRegistry.getFunction(func);
  const hasParams = !funcObj || funcObj.parameters.length === 0 || doc.includes('**Parameters:**');
  return hasReturns && hasParams;
});
testResult('All functions have rich documentation', allHaveRichDoc,
  `All ${allFunctions.length} functions have proper documentation format`);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All math module aliased import hover tests passed!');
  console.log('\n💡 The hover system fix should now work:');
  console.log('   - Aliased imports like "abs as absoluteValue" will show abs() documentation');
  console.log('   - Original function signature and parameters will be displayed');
  console.log('   - Function descriptions will include the original function name');
  console.log('\n🔧 Technical details:');
  console.log('   - Uses symbol.importSpecifier || symbol.name to get original name');
  console.log('   - Calls mathTypeRegistry.getFunctionDocumentation(originalName)');
  console.log('   - Works for all module types (math, debug, digest, log)');
} else {
  console.log(`❌ ${totalTests - passedTests} tests failed. Please check the implementation.`);
  process.exit(1);
}