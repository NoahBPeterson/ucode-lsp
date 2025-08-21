// Test enhanced logical operator type inference based on runtime behavior
console.log('🔧 Running Enhanced Logical Type Inference Tests...\n');

const { UcodeType, createUnionType, isUnionType, getUnionTypes } = require('../src/analysis/symbolTable');
const { logicalTypeInference } = require('../src/analysis/logicalTypeInference');

let totalTests = 0;
let passedTests = 0;

function testLogicalInference(testName, testFunc, expectedChecker) {
    console.log(`🧪 Testing ${testName}:`);
    totalTests++;
    
    try {
        const result = testFunc();
        const passed = expectedChecker(result);
        console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        if (!passed) {
            console.log(`  Got: ${JSON.stringify(result)}`);
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

console.log('=== LOGICAL OR (||) TYPE INFERENCE ===');

// Test 1: null || X → always returns X type (null is definitely falsy)
testLogicalInference('null || integer → integer', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.NULL, UcodeType.INTEGER);
}, (result) => result === UcodeType.INTEGER);

testLogicalInference('null || string → string', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.NULL, UcodeType.STRING);
}, (result) => result === UcodeType.STRING);

// Test 2: array || X → always returns array type (arrays are definitely truthy)
testLogicalInference('array || integer → array', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.ARRAY, UcodeType.INTEGER);
}, (result) => result === UcodeType.ARRAY);

testLogicalInference('object || string → object', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.OBJECT, UcodeType.STRING);
}, (result) => result === UcodeType.OBJECT);

// Test 3: integer || X → creates union (integers can be 0 or non-zero)
testLogicalInference('integer || string → integer | string union', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.INTEGER, UcodeType.STRING);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.INTEGER) &&
           getUnionTypes(result).includes(UcodeType.STRING);
});

// Test 4: boolean || X → creates union (booleans can be true or false)
testLogicalInference('boolean || integer → boolean | integer union', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.BOOLEAN, UcodeType.INTEGER);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.BOOLEAN) &&
           getUnionTypes(result).includes(UcodeType.INTEGER);
});

// Test 5: string || X → creates union (strings can be "" or non-empty)
testLogicalInference('string || boolean → string | boolean union', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.STRING, UcodeType.BOOLEAN);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.STRING) &&
           getUnionTypes(result).includes(UcodeType.BOOLEAN);
});

// Test 6: Same types return single type
testLogicalInference('integer || integer → integer', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.INTEGER, UcodeType.INTEGER);
}, (result) => result === UcodeType.INTEGER);

console.log('\n=== LOGICAL AND (&&) TYPE INFERENCE ===');

// Test 7: null && X → always returns null (null is definitely falsy)
testLogicalInference('null && integer → null', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.NULL, UcodeType.INTEGER);
}, (result) => result === UcodeType.NULL);

testLogicalInference('null && string → null', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.NULL, UcodeType.STRING);
}, (result) => result === UcodeType.NULL);

// Test 8: array && X → always returns X type (arrays are definitely truthy)
testLogicalInference('array && integer → integer', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.ARRAY, UcodeType.INTEGER);
}, (result) => result === UcodeType.INTEGER);

testLogicalInference('object && string → string', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.OBJECT, UcodeType.STRING);
}, (result) => result === UcodeType.STRING);

// Test 9: integer && X → creates union (integers can be 0 or non-zero)
testLogicalInference('integer && string → integer | string union', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.INTEGER, UcodeType.STRING);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.INTEGER) &&
           getUnionTypes(result).includes(UcodeType.STRING);
});

// Test 10: boolean && X → creates union (booleans can be true or false)
testLogicalInference('boolean && integer → boolean | integer union', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.BOOLEAN, UcodeType.INTEGER);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.BOOLEAN) &&
           getUnionTypes(result).includes(UcodeType.INTEGER);
});

// Test 11: Function types (definitely truthy)
testLogicalInference('function || string → function', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.FUNCTION, UcodeType.STRING);
}, (result) => result === UcodeType.FUNCTION);

testLogicalInference('regex && boolean → boolean', () => {
    return logicalTypeInference.inferLogicalAndType(UcodeType.REGEX, UcodeType.BOOLEAN);
}, (result) => result === UcodeType.BOOLEAN);

// Test 12: Double type inference (can be 0.0 or non-zero)
testLogicalInference('double || integer → double | integer union', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.DOUBLE, UcodeType.INTEGER);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.DOUBLE) &&
           getUnionTypes(result).includes(UcodeType.INTEGER);
});

// Test 13: Unknown type handling
testLogicalInference('unknown || string → unknown | string union', () => {
    return logicalTypeInference.inferLogicalOrType(UcodeType.UNKNOWN, UcodeType.STRING);
}, (result) => {
    return isUnionType(result) &&
           getUnionTypes(result).includes(UcodeType.UNKNOWN) &&
           getUnionTypes(result).includes(UcodeType.STRING);
});

console.log('\n=== EDGE CASES ===');

// Test 14: All definitely truthy types
const definitelyTruthyTypes = [UcodeType.ARRAY, UcodeType.OBJECT, UcodeType.FUNCTION, UcodeType.REGEX];
definitelyTruthyTypes.forEach((truthyType) => {
    testLogicalInference(`${truthyType} || any → ${truthyType}`, () => {
        return logicalTypeInference.inferLogicalOrType(truthyType, UcodeType.INTEGER);
    }, (result) => result === truthyType);
    
    testLogicalInference(`${truthyType} && any → any`, () => {
        return logicalTypeInference.inferLogicalAndType(truthyType, UcodeType.STRING);
    }, (result) => result === UcodeType.STRING);
});

console.log(`\n📊 Logical Type Inference Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('✅ All logical type inference tests passed!');
} else {
    console.log(`❌ ${totalTests - passedTests} tests failed`);
    process.exit(1);
}