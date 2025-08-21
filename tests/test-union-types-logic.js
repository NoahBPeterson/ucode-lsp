// Unit test for union types functionality
// Tests union type creation, merging, and type compatibility logic

console.log('🔧 Running Union Types Logic Tests...\n');

const { UcodeType, createUnionType, isUnionType, getUnionTypes, typeToString, isTypeCompatible } = require('../src/analysis/symbolTable');
const { TypeCompatibilityChecker } = require('../src/analysis/checkers/typeCompatibility');

let totalTests = 0;
let passedTests = 0;

function testUnionTypeFunction(testName, testFunc, expected) {
    console.log(`🧪 Testing ${testName}:`);
    totalTests++;
    
    try {
        const result = testFunc();
        const passed = JSON.stringify(result) === JSON.stringify(expected);
        console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
        if (!passed) {
            console.log(`  Expected: ${JSON.stringify(expected)}`);
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

function testUnionTypeAssertion(testName, testFunc, expected) {
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

// Test 1: Union type creation with single type
testUnionTypeFunction('createUnionType with single type', () => {
    return createUnionType([UcodeType.STRING]);
}, UcodeType.STRING);

// Test 2: Union type creation with multiple types
testUnionTypeFunction('createUnionType with multiple types', () => {
    return createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
}, {
    type: UcodeType.UNION,
    types: [UcodeType.STRING, UcodeType.INTEGER]
});

// Test 3: Union type creation with duplicate types
testUnionTypeFunction('createUnionType with duplicate types', () => {
    return createUnionType([UcodeType.STRING, UcodeType.STRING, UcodeType.INTEGER]);
}, {
    type: UcodeType.UNION,
    types: [UcodeType.STRING, UcodeType.INTEGER]
});

// Test 4: Union type creation with empty array
testUnionTypeFunction('createUnionType with empty array', () => {
    return createUnionType([]);
}, UcodeType.UNKNOWN);

// Test 5: isUnionType detection for union types
testUnionTypeAssertion('isUnionType detection for union type', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return isUnionType(unionType);
}, true);

// Test 6: isUnionType detection for simple types
testUnionTypeAssertion('isUnionType detection for simple type', () => {
    return isUnionType(UcodeType.STRING);
}, false);

// Test 7: getUnionTypes for union type
testUnionTypeFunction('getUnionTypes for union type', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return getUnionTypes(unionType);
}, [UcodeType.STRING, UcodeType.INTEGER]);

// Test 8: getUnionTypes for simple type
testUnionTypeFunction('getUnionTypes for simple type', () => {
    return getUnionTypes(UcodeType.BOOLEAN);
}, [UcodeType.BOOLEAN]);

// Test 9: typeToString for union type
testUnionTypeAssertion('typeToString for union type', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return typeToString(unionType);
}, "string | integer");

// Test 10: typeToString for simple type
testUnionTypeAssertion('typeToString for simple type', () => {
    return typeToString(UcodeType.BOOLEAN);
}, UcodeType.BOOLEAN);

// Test 11: isTypeCompatible with union types - compatible case
testUnionTypeAssertion('isTypeCompatible with union type - compatible', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return isTypeCompatible(UcodeType.STRING, unionType);
}, true);

// Test 12: isTypeCompatible with union types - incompatible case
testUnionTypeAssertion('isTypeCompatible with union type - incompatible', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return isTypeCompatible(UcodeType.BOOLEAN, unionType);
}, false);

// Test 13: TypeCompatibilityChecker getCommonType for mixed types
testUnionTypeFunction('TypeCompatibilityChecker getCommonType for mixed types', () => {
    const checker = new TypeCompatibilityChecker();
    return checker.getCommonType([UcodeType.STRING, UcodeType.INTEGER]);
}, {
    type: UcodeType.UNION,
    types: [UcodeType.STRING, UcodeType.INTEGER]
});

// Test 14: TypeCompatibilityChecker getCommonType for numeric types
testUnionTypeFunction('TypeCompatibilityChecker getCommonType for numeric types', () => {
    const checker = new TypeCompatibilityChecker();
    return checker.getCommonType([UcodeType.INTEGER, UcodeType.DOUBLE]);
}, UcodeType.DOUBLE);

// Test 15: Complex nested union type handling
testUnionTypeFunction('Complex nested union type handling', () => {
    const innerUnion = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    const complexUnion = createUnionType([...getUnionTypes(innerUnion), UcodeType.BOOLEAN]);
    return complexUnion;
}, {
    type: UcodeType.UNION,
    types: [UcodeType.STRING, UcodeType.INTEGER, UcodeType.BOOLEAN]
});

// Test 16: Union type with UNKNOWN types
testUnionTypeFunction('Union type with UNKNOWN types', () => {
    return createUnionType([UcodeType.STRING, UcodeType.UNKNOWN, UcodeType.INTEGER]);
}, {
    type: UcodeType.UNION,
    types: [UcodeType.STRING, UcodeType.UNKNOWN, UcodeType.INTEGER]
});

// Test 17: Union type compatibility with UNKNOWN
testUnionTypeAssertion('Union type compatibility with UNKNOWN', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return isTypeCompatible(UcodeType.UNKNOWN, unionType);
}, true);

// Test 18: Reverse union type compatibility
testUnionTypeAssertion('Reverse union type compatibility', () => {
    const unionType = createUnionType([UcodeType.STRING, UcodeType.INTEGER]);
    return isTypeCompatible(unionType, UcodeType.STRING);
}, true);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('✅ All union type logic tests passed!');
} else {
    console.log(`❌ ${totalTests - passedTests} tests failed`);
    process.exit(1);
}