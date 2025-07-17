// Unit test for validation-only mode and isolated validation testing

// Mock TokenType enum
const TokenType = {
    TK_LABEL: 1,
    TK_LPAREN: 2,
    TK_RPAREN: 3,
    TK_NUMBER: 4,
    TK_STRING: 5,
    TK_COMMA: 6
};

// Mock isolated validation engine
class MockValidationEngine {
    constructor() {
        this.validationRules = new Map();
        this.setupDefaultRules();
    }
    
    setupDefaultRules() {
        // String analysis rules
        this.validationRules.set('length', {
            paramCount: 1,
            paramTypes: ['string'],
            category: 'string-analysis'
        });
        
        this.validationRules.set('index', {
            paramCount: 2,
            paramTypes: ['string', 'string'],
            category: 'string-analysis'
        });
        
        // Array function rules
        this.validationRules.set('filter', {
            paramCount: 2,
            paramTypes: ['array', 'function'],
            category: 'array-functions'
        });
        
        this.validationRules.set('map', {
            paramCount: 2,
            paramTypes: ['array', 'function'],
            category: 'array-functions'
        });
        
        // Object function rules
        this.validationRules.set('keys', {
            paramCount: 1,
            paramTypes: ['object'],
            category: 'object-functions'
        });
        
        this.validationRules.set('values', {
            paramCount: 1,
            paramTypes: ['object'],
            category: 'object-functions'
        });
    }
    
    validateFunction(functionName, params) {
        const rule = this.validationRules.get(functionName);
        if (!rule) {
            return { isValid: true, errors: [], category: 'unknown' };
        }
        
        const errors = [];
        
        // Check parameter count
        if (params.length !== rule.paramCount) {
            errors.push(`${functionName}() expects ${rule.paramCount} parameter(s), got ${params.length}`);
        }
        
        // Check parameter types
        for (let i = 0; i < Math.min(params.length, rule.paramTypes.length); i++) {
            const expectedType = rule.paramTypes[i];
            const actualParam = params[i];
            
            let actualType = 'unknown';
            if (actualParam.type === TokenType.TK_STRING) actualType = 'string';
            else if (actualParam.type === TokenType.TK_NUMBER) actualType = 'number';
            else if (actualParam.type === TokenType.TK_LABEL) actualType = 'variable';
            
            // Type validation logic
            if (expectedType === 'string' && actualType === 'number') {
                errors.push(`${functionName}() parameter ${i + 1} should be ${expectedType}, got ${actualType}`);
            } else if (expectedType === 'array' && actualType === 'string') {
                errors.push(`${functionName}() parameter ${i + 1} should be ${expectedType}, got ${actualType}`);
            } else if (expectedType === 'object' && (actualType === 'string' || actualType === 'number')) {
                errors.push(`${functionName}() parameter ${i + 1} should be ${expectedType}, got ${actualType}`);
            } else if (expectedType === 'function' && actualType === 'number') {
                errors.push(`${functionName}() parameter ${i + 1} should be ${expectedType}, got ${actualType}`);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors,
            category: rule.category
        };
    }
    
    getValidationStats() {
        const categories = {};
        for (const [funcName, rule] of this.validationRules) {
            if (!categories[rule.category]) {
                categories[rule.category] = 0;
            }
            categories[rule.category]++;
        }
        return {
            totalFunctions: this.validationRules.size,
            categories: categories
        };
    }
}

// Test cases for validation-only mode
const testCases = [
    {
        name: "string analysis validation - length with number",
        functionName: "length",
        params: [{ type: TokenType.TK_NUMBER, value: "123" }],
        expectedErrors: 1,
        category: "string-analysis",
        description: "Should detect invalid number parameter for length()"
    },
    {
        name: "string analysis validation - valid length",
        functionName: "length",
        params: [{ type: TokenType.TK_STRING, value: '"hello"' }],
        expectedErrors: 0,
        category: "string-analysis",
        description: "Should accept valid string parameter for length()"
    },
    {
        name: "array function validation - filter with string",
        functionName: "filter",
        params: [{ type: TokenType.TK_STRING, value: '"array"' }, { type: TokenType.TK_LABEL, value: "func" }],
        expectedErrors: 1,
        category: "array-functions",
        description: "Should detect invalid string parameter for filter()"
    },
    {
        name: "array function validation - valid filter",
        functionName: "filter",
        params: [{ type: TokenType.TK_LABEL, value: "myArray" }, { type: TokenType.TK_LABEL, value: "myFunc" }],
        expectedErrors: 0,
        category: "array-functions",
        description: "Should accept valid parameters for filter()"
    },
    {
        name: "object function validation - keys with string",
        functionName: "keys",
        params: [{ type: TokenType.TK_STRING, value: '"object"' }],
        expectedErrors: 1,
        category: "object-functions",
        description: "Should detect invalid string parameter for keys()"
    },
    {
        name: "object function validation - valid keys",
        functionName: "keys",
        params: [{ type: TokenType.TK_LABEL, value: "myObj" }],
        expectedErrors: 0,
        category: "object-functions",
        description: "Should accept valid object parameter for keys()"
    }
];

function testValidationOnly(testName, functionName, params, expectedErrors, category) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const validator = new MockValidationEngine();
    const result = validator.validateFunction(functionName, params);
    
    const actualErrors = result.errors.length;
    const categoryCorrect = result.category === category;
    const errorCountCorrect = (expectedErrors > 0 && actualErrors > 0) || (expectedErrors === 0 && actualErrors === 0);
    
    const testPassed = categoryCorrect && errorCountCorrect;
    
    console.log(`  Function: ${functionName}()`);
    console.log(`  Category: ${result.category} ${categoryCorrect ? '✅' : '❌'} (expected: ${category})`);
    console.log(`  Parameters: [${params.map(p => `${p.type}:${p.value}`).join(', ')}]`);
    console.log(`  Expected errors: ${expectedErrors}, Found: ${actualErrors} ${errorCountCorrect ? '✅' : '❌'}`);
    
    if (result.errors.length > 0) {
        result.errors.forEach((error, i) => {
            console.log(`    ${i + 1}. ${error}`);
        });
    }
    
    console.log(`  Result: ${testPassed ? '✅ PASS' : '❌ FAIL'}`);
    
    return testPassed;
}

console.log('🧪 Testing Validation-Only Mode...\n');

const validator = new MockValidationEngine();
const stats = validator.getValidationStats();

console.log('📊 Validation Engine Statistics:');
console.log(`  Total validation rules: ${stats.totalFunctions}`);
Object.entries(stats.categories).forEach(([category, count]) => {
    console.log(`  ${category}: ${count} functions`);
});

let totalTests = 0;
let passedTests = 0;
let categoryCounts = {};

testCases.forEach((testCase) => {
    totalTests++;
    if (!categoryCounts[testCase.category]) {
        categoryCounts[testCase.category] = { total: 0, passed: 0 };
    }
    categoryCounts[testCase.category].total++;
    
    if (testValidationOnly(
        testCase.name,
        testCase.functionName,
        testCase.params,
        testCase.expectedErrors,
        testCase.category
    )) {
        passedTests++;
        categoryCounts[testCase.category].passed++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

console.log('\n📈 Results by Category:');
Object.entries(categoryCounts).forEach(([category, counts]) => {
    const percentage = (counts.passed / counts.total * 100).toFixed(1);
    console.log(`  ${category}: ${counts.passed}/${counts.total} (${percentage}%)`);
});

if (passedTests === totalTests) {
    console.log('\n🎉 All validation-only mode tests passed!');
    console.log('✅ Isolated validation engine working correctly');
    console.log('✅ All function categories properly validated');
    console.log('✅ Parameter type checking isolated and testable');
    console.log('✅ Validation rules properly categorized');
} else {
    console.log('\n❌ Some tests failed. Check validation-only implementation.');
}

console.log('\n💡 Note: These test the validation engine in isolation without language server.');
console.log('💡 Validation-only mode enables focused testing of validation logic.');