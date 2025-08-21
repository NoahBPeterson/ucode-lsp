// Test enhanced arithmetic type inference based on runtime behavior
console.log('🔧 Running Enhanced Arithmetic Type Inference Tests...\n');

const { UcodeType } = require('../src/analysis/symbolTable');
const { arithmeticTypeInference } = require('../src/analysis/arithmeticTypeInference');

let totalTests = 0;
let passedTests = 0;

function testArithmeticInference(testName, testFunc, expectedType) {
    console.log(`🧪 Testing ${testName}:`);
    totalTests++;
    
    try {
        const result = testFunc();
        const passed = result === expectedType;
        console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        if (!passed) {
            console.log(`  Expected: ${expectedType}`);
            console.log(`  Got: ${result}`);
        }
        
        if (passed) {
            passedTests++;
        }
        return passed;
    } catch (error) {
        console.log(`  Result: ❌ FAIL (Error: ${error.message})`);
        return false;
    }
}

console.log('=== ADDITION (+) TYPE INFERENCE ===');

// Test 1: String concatenation (highest priority)
testArithmeticInference('string + integer → string', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.STRING, UcodeType.INTEGER);
}, UcodeType.STRING);

testArithmeticInference('integer + string → string', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.INTEGER, UcodeType.STRING);
}, UcodeType.STRING);

testArithmeticInference('string + double → string', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.STRING, UcodeType.DOUBLE);
}, UcodeType.STRING);

testArithmeticInference('boolean + string → string', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.BOOLEAN, UcodeType.STRING);
}, UcodeType.STRING);

testArithmeticInference('null + string → string', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.NULL, UcodeType.STRING);
}, UcodeType.STRING);

// Test 2: Numeric addition with promotion
testArithmeticInference('integer + double → double', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.INTEGER, UcodeType.DOUBLE);
}, UcodeType.DOUBLE);

testArithmeticInference('double + integer → double', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.DOUBLE, UcodeType.INTEGER);
}, UcodeType.DOUBLE);

testArithmeticInference('integer + integer → integer', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.INTEGER, UcodeType.INTEGER);
}, UcodeType.INTEGER);

// Test 3: Boolean and null coercion in addition
testArithmeticInference('integer + boolean → integer', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.INTEGER, UcodeType.BOOLEAN);
}, UcodeType.INTEGER);

testArithmeticInference('null + integer → integer', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.NULL, UcodeType.INTEGER);
}, UcodeType.INTEGER);

testArithmeticInference('boolean + boolean → integer', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.BOOLEAN, UcodeType.BOOLEAN);
}, UcodeType.INTEGER);

// Test 4: Invalid additions that produce NaN
testArithmeticInference('array + integer → double (NaN)', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.ARRAY, UcodeType.INTEGER);
}, UcodeType.DOUBLE);

testArithmeticInference('object + integer → double (NaN)', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.OBJECT, UcodeType.INTEGER);
}, UcodeType.DOUBLE);

console.log('\n=== ARITHMETIC (-, *, /, %) TYPE INFERENCE ===');

// Test 5: Standard numeric operations
testArithmeticInference('integer - integer → integer', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.INTEGER, '-');
}, UcodeType.INTEGER);

testArithmeticInference('integer * double → double', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.DOUBLE, '*');
}, UcodeType.DOUBLE);

testArithmeticInference('double / integer → double', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.DOUBLE, UcodeType.INTEGER, '/');
}, UcodeType.DOUBLE);

testArithmeticInference('integer % integer → integer', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.INTEGER, '%');
}, UcodeType.INTEGER);

// Test 6: Boolean coercion in arithmetic
testArithmeticInference('integer - boolean → integer', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.BOOLEAN, '-');
}, UcodeType.INTEGER);

testArithmeticInference('boolean * boolean → integer', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.BOOLEAN, UcodeType.BOOLEAN, '*');
}, UcodeType.INTEGER);

// Test 7: Null coercion in arithmetic  
testArithmeticInference('null - integer → integer', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.NULL, UcodeType.INTEGER, '-');
}, UcodeType.INTEGER);

testArithmeticInference('integer * null → integer', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.NULL, '*');
}, UcodeType.INTEGER);

// Test 8: String operations that produce NaN
testArithmeticInference('string - integer → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.STRING, UcodeType.INTEGER, '-');
}, UcodeType.DOUBLE);

testArithmeticInference('integer * string → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.STRING, '*');
}, UcodeType.DOUBLE);

// Test 9: Array/object operations that produce NaN
testArithmeticInference('array - integer → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.ARRAY, UcodeType.INTEGER, '-');
}, UcodeType.DOUBLE);

testArithmeticInference('object / integer → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.OBJECT, UcodeType.INTEGER, '/');
}, UcodeType.DOUBLE);

testArithmeticInference('integer % array → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.ARRAY, '%');
}, UcodeType.DOUBLE);

// Test 10: Function and regex operations
testArithmeticInference('function - integer → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.FUNCTION, UcodeType.INTEGER, '-');
}, UcodeType.DOUBLE);

testArithmeticInference('regex * integer → double (NaN)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.REGEX, UcodeType.INTEGER, '*');
}, UcodeType.DOUBLE);

console.log('\n=== EDGE CASES ===');

// Test 11: Double precision preservation
testArithmeticInference('double - double → double', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.DOUBLE, UcodeType.DOUBLE, '-');
}, UcodeType.DOUBLE);

// Test 12: Unknown type handling
testArithmeticInference('unknown + integer → double (safe fallback)', () => {
    return arithmeticTypeInference.inferAdditionType(UcodeType.UNKNOWN, UcodeType.INTEGER);
}, UcodeType.DOUBLE);

testArithmeticInference('integer - unknown → double (safe fallback)', () => {
    return arithmeticTypeInference.inferArithmeticType(UcodeType.INTEGER, UcodeType.UNKNOWN, '-');
}, UcodeType.DOUBLE);

console.log(`\n📊 Arithmetic Type Inference Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('✅ All arithmetic type inference tests passed!');
    
    // Show some examples
    console.log('\n=== EXAMPLE EXPLANATIONS ===');
    const examples = arithmeticTypeInference.getArithmeticExamples();
    examples.slice(0, 3).forEach(example => {
        console.log(`${example.example}: ${example.explanation}`);
    });
} else {
    console.log(`❌ ${totalTests - passedTests} tests failed`);
    process.exit(1);
}