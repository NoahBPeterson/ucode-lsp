// Enhanced union type compatibility tests
// Tests the new TypeCompatibilityChecker methods with union types

console.log('🔧 Running Enhanced Union Types Compatibility Tests...\n');

const { UcodeType, createUnionType, isUnionType, getUnionTypes, typeToString } = require('../../src/analysis/symbolTable');
const { TypeCompatibilityChecker } = require('../../src/analysis/checkers/typeCompatibility');

let totalTests = 0;
let passedTests = 0;

function testTypeCompatibility(testName, testFunc, expected) {
    console.log(`🧪 Testing ${testName}:`);
    totalTests++;
    
    try {
        const result = testFunc();
        const passed = result === expected;
        console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        if (!passed) {
            console.log(`  Expected: ${expected}`);
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

function testTypeResult(testName, testFunc, expectedChecker) {
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

const checker = new TypeCompatibilityChecker();

// NOTE: isTypeCompatible/canAssign were removed — ucode is dynamically typed, so
// assignment has no type-compatibility constraint and the method had no callers.
// Remaining tests cover the live getTernaryResultType / getCommonType methods.

// Test 7: Enhanced getTernaryResultType with same types
testTypeResult('getTernaryResultType: same types', () => {
    return checker.getTernaryResultType(UcodeType.STRING, UcodeType.STRING);
}, (result) => result === UcodeType.STRING);

// Test 8: Enhanced getTernaryResultType with different types (creates union)
testTypeResult('getTernaryResultType: different types creates union', () => {
    return checker.getTernaryResultType(UcodeType.STRING, UcodeType.INTEGER);
}, (result) => {
    return isUnionType(result) && 
           getUnionTypes(result).includes(UcodeType.STRING) && 
           getUnionTypes(result).includes(UcodeType.INTEGER);
});

// Test 12: getCommonType with multiple same types
testTypeResult('getCommonType: multiple same types', () => {
    return checker.getCommonType([UcodeType.STRING, UcodeType.STRING, UcodeType.STRING]);
}, (result) => result === UcodeType.STRING);

// Test 13: getCommonType with numeric types (promotion)
testTypeResult('getCommonType: numeric types promotion', () => {
    return checker.getCommonType([UcodeType.INTEGER, UcodeType.DOUBLE, UcodeType.INTEGER]);
}, (result) => result === UcodeType.DOUBLE);

// Test 14: getCommonType with truly mixed types (creates union)
testTypeResult('getCommonType: mixed types creates union', () => {
    return checker.getCommonType([UcodeType.STRING, UcodeType.BOOLEAN, UcodeType.INTEGER]);
}, (result) => {
    return isUnionType(result) && 
           getUnionTypes(result).includes(UcodeType.STRING) && 
           getUnionTypes(result).includes(UcodeType.BOOLEAN) && 
           getUnionTypes(result).includes(UcodeType.INTEGER);
});

// Test 15: getCommonType with empty array
testTypeResult('getCommonType: empty array returns NULL', () => {
    return checker.getCommonType([]);
}, (result) => result === UcodeType.NULL);

console.log(`\n📊 Enhanced Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('✅ All enhanced union type compatibility tests passed!');
} else {
    console.log(`❌ ${totalTests - passedTests} tests failed`);
    process.exit(1);
}