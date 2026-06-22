// Unit test for union type inference with unknown return types

// Mock the UcodeType enum
const UcodeType = {
    INTEGER: 'integer',
    DOUBLE: 'double', 
    STRING: 'string',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
    OBJECT: 'object',
    FUNCTION: 'function',
    NULL: 'null',
    UNKNOWN: 'unknown',
    UNION: 'union'
};

// Mock the createUnionType function (this is the actual implementation)
function createUnionType(types) {
    // Remove duplicates but preserve UNKNOWN types (they represent valid unknown return types)
    const uniqueTypes = [...new Set(types)];
    
    if (uniqueTypes.length === 0) {
        return UcodeType.UNKNOWN;
    }
    
    if (uniqueTypes.length === 1) {
        return uniqueTypes[0];
    }
    
    return {
        type: UcodeType.UNION,
        types: uniqueTypes
    };
}

// Mock function to simulate type inference for functions returning mixed types
function inferReturnType(returnStatements) {
    const returnTypes = [];
    
    for (const stmt of returnStatements) {
        if (stmt.type === 'string_literal') {
            returnTypes.push(UcodeType.STRING);
        } else if (stmt.type === 'number_literal') {
            returnTypes.push(UcodeType.INTEGER);
        } else if (stmt.type === 'double_literal') {
            returnTypes.push(UcodeType.DOUBLE);
        } else if (stmt.type === 'parameter') {
            // Parameters have unknown type unless specified
            returnTypes.push(UcodeType.UNKNOWN);
        } else if (stmt.type === 'null_literal') {
            returnTypes.push(UcodeType.NULL);
        } else {
            returnTypes.push(UcodeType.UNKNOWN);
        }
    }
    
    return createUnionType(returnTypes);
}

// Test cases for union type inference with unknown return types
const testCases = [
    {
        name: "function returning string and unknown (parameter)",
        returnStatements: [
            { type: 'string_literal', value: 'negative' },
            { type: 'string_literal', value: 'too high' },
            { type: 'parameter', name: 'val' }  // Unknown type
        ],
        expectedType: { type: UcodeType.UNION, types: [UcodeType.STRING, UcodeType.UNKNOWN] },
        description: "Should create union of string | unknown"
    },
    {
        name: "function returning only unknown (parameter)",
        returnStatements: [
            { type: 'parameter', name: 'x' }  // Unknown type
        ],
        expectedType: UcodeType.UNKNOWN,
        description: "Should return unknown type for identity function"
    },
    {
        name: "function returning integer, string, and unknown",
        returnStatements: [
            { type: 'number_literal', value: 0 },
            { type: 'string_literal', value: 'processed' },
            { type: 'parameter', name: 'input' }  // Unknown type
        ],
        expectedType: { type: UcodeType.UNION, types: [UcodeType.INTEGER, UcodeType.STRING, UcodeType.UNKNOWN] },
        description: "Should create union of integer | string | unknown"
    },
    {
        name: "function returning only known types",
        returnStatements: [
            { type: 'string_literal', value: 'hello' },
            { type: 'number_literal', value: 42 }
        ],
        expectedType: { type: UcodeType.UNION, types: [UcodeType.STRING, UcodeType.INTEGER] },
        description: "Should create union without unknown types"
    },
    {
        name: "function with duplicate types including unknown",
        returnStatements: [
            { type: 'string_literal', value: 'a' },
            { type: 'string_literal', value: 'b' },
            { type: 'parameter', name: 'x' },
            { type: 'parameter', name: 'y' }
        ],
        expectedType: { type: UcodeType.UNION, types: [UcodeType.STRING, UcodeType.UNKNOWN] },
        description: "Should deduplicate types but preserve unknown"
    },
    {
        name: "function returning null and unknown",
        returnStatements: [
            { type: 'null_literal' },
            { type: 'parameter', name: 'value' }
        ],
        expectedType: { type: UcodeType.UNION, types: [UcodeType.NULL, UcodeType.UNKNOWN] },
        description: "Should create union of null | unknown"
    }
];

// Helper function to compare types
function typesEqual(actual, expected) {
    if (typeof expected === 'string') {
        return actual === expected;
    }
    
    if (typeof expected === 'object' && expected.type === UcodeType.UNION) {
        if (typeof actual !== 'object' || actual.type !== UcodeType.UNION) {
            return false;
        }
        
        if (actual.types.length !== expected.types.length) {
            return false;
        }
        
        // Check if all expected types are present (order doesn't matter)
        for (const expectedType of expected.types) {
            if (!actual.types.includes(expectedType)) {
                return false;
            }
        }
        
        return true;
    }
    
    return false;
}

// Helper function to format type for display
function formatType(type) {
    if (typeof type === 'string') {
        return type;
    }
    
    if (typeof type === 'object' && type.type === UcodeType.UNION) {
        return type.types.join(' | ');
    }
    
    return 'unknown format';
}

// Test function
function testUnionTypeInference(testName, returnStatements, expectedType) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const actualType = inferReturnType(returnStatements);
    const result = typesEqual(actualType, expectedType);
    
    console.log(`  Expected: ${formatType(expectedType)}`);
    console.log(`  Actual: ${formatType(actualType)}`);
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing Union Type Inference with Unknown Return Types...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testUnionTypeInference(
        testCase.name,
        testCase.returnStatements,
        testCase.expectedType
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All union type inference tests passed!');
} else {
    console.log('❌ Some tests failed. Check type inference logic.');
}

console.log('\n💡 Note: These test the union type inference logic for functions with unknown return types.');
console.log('💡 The fix ensures that UNKNOWN types are preserved in union types, not filtered out.');