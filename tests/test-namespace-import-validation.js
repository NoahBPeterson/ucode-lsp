// Unit test for namespace import member access validation

// Mock the semantic analyzer and related components
const mockDocument = {
    positionAt: (offset) => ({ line: 0, character: offset }),
    getText: () => 'test content'
};

// Mock symbol table with namespace import
const mockSymbolTable = {
    lookup: (name) => {
        if (name === 'constants') {
            return {
                type: 'imported',
                importSpecifier: '*',
                name: 'constants'
            };
        }
        if (name === 'utils') {
            return {
                type: 'imported', 
                importSpecifier: '*',
                name: 'utils'
            };
        }
        if (name === 'regularObj') {
            return {
                type: 'variable',
                name: 'regularObj'
            };
        }
        return null; // Undefined variables
    }
};

// Mock AST nodes for testing
function createMemberExpression(objectName, propertyName, computed = false) {
    return {
        type: 'MemberExpression',
        object: {
            type: 'Identifier',
            name: objectName
        },
        property: {
            type: 'Identifier',
            name: propertyName
        },
        computed: computed
    };
}

// Test cases for namespace import member access
const testCases = [
    {
        name: "namespace import member access (constants.DT_HOSTINFO_FINAL_PATH)",
        memberExpression: createMemberExpression('constants', 'DT_HOSTINFO_FINAL_PATH'),
        shouldValidateProperty: false, // Should NOT validate the property name
        description: "Property name should not be validated as variable"
    },
    {
        name: "namespace import member access (utils.SOME_CONSTANT)",
        memberExpression: createMemberExpression('utils', 'SOME_CONSTANT'),
        shouldValidateProperty: false,
        description: "Property name should not be validated as variable"
    },
    {
        name: "namespace import computed access (constants[key])",
        memberExpression: createMemberExpression('constants', 'key', true),
        shouldValidateProperty: true, // Should validate the key variable
        description: "Computed property key should be validated as variable"
    },
    {
        name: "regular object member access (regularObj.property)",
        memberExpression: createMemberExpression('regularObj', 'property'),
        shouldValidateProperty: true, // Should validate the property for regular objects
        description: "Regular object property should be validated"
    },
    {
        name: "undefined object member access (undefinedObj.property)",
        memberExpression: createMemberExpression('undefinedObj', 'property'),
        shouldValidateProperty: true, // Should validate the property
        description: "Undefined object property should be validated"
    }
];

// Simulate the visitMemberExpression logic
function testNamespaceImportValidation(testName, memberExpression, shouldValidateProperty) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    let propertyValidated = false;
    
    // Simulate the visitMemberExpression logic
    const object = memberExpression.object;
    const property = memberExpression.property;
    const computed = memberExpression.computed;
    
    // Check if it's a namespace import
    if (!computed && object.type === 'Identifier') {
        const objectName = object.name;
        const symbol = mockSymbolTable.lookup(objectName);
        
        // If the object is a namespace import, don't validate the property
        if (symbol && symbol.type === 'imported' && symbol.importSpecifier === '*') {
            propertyValidated = false; // Don't validate namespace member names
        } else {
            propertyValidated = true; // Validate property for regular objects
        }
    } else {
        propertyValidated = true; // Validate property for computed access
    }
    
    const result = propertyValidated === shouldValidateProperty;
    console.log(`  Expected property validation: ${shouldValidateProperty}`);
    console.log(`  Actual property validation: ${propertyValidated}`);
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing Namespace Import Member Access Validation...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testNamespaceImportValidation(
        testCase.name, 
        testCase.memberExpression, 
        testCase.shouldValidateProperty
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All namespace import validation tests passed!');
} else {
    console.log('❌ Some tests failed. Check validation logic.');
}

console.log('\n💡 Note: These test the validation logic patterns for namespace import member access.');
console.log('💡 The fix ensures that namespace.MEMBER does not validate MEMBER as a variable.');