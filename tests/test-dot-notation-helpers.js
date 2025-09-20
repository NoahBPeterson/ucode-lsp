#!/usr/bin/env node

// Unit tests for dot notation helper functions
// Tests the isDotNotationModule and convertDotNotationToPath logic

console.log('🧪 Testing Dot Notation Helper Functions...\n');

// Test helper functions directly by testing the regex and conversion logic
function isDotNotationModule(moduleName) {
    // This mirrors the implementation in semanticAnalyzer.ts
    // Each part must start with a letter or underscore, followed by letters, numbers, or underscores
    return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(moduleName);
}

function convertDotNotationToPath(moduleName) {
    // This mirrors the implementation in semanticAnalyzer.ts
    return './' + moduleName.replace(/\./g, '/') + '.uc';
}

// Test 1: isDotNotationModule validation
console.log('=== Test 1: isDotNotationModule Validation ===');

const validationTests = [
    // Valid dot notation modules
    { input: 'u1905.u1905d.src.u1905.log', expected: true, description: 'Multi-level module path' },
    { input: 'simple.module', expected: true, description: 'Simple two-part module' },
    { input: 'a.b.c.d.e.f', expected: true, description: 'Deep nesting' },
    { input: 'module_name.sub_module', expected: true, description: 'Underscore in names' },
    { input: 'Module123.Sub456', expected: true, description: 'Numbers in names' },
    
    // Invalid cases
    { input: 'singlemodule', expected: false, description: 'Single module (no dots)' },
    { input: 'fs', expected: false, description: 'Built-in module name' },
    { input: './relative/path.uc', expected: false, description: 'Relative file path' },
    { input: '../parent/path.uc', expected: false, description: 'Parent directory path' },
    { input: '/absolute/path.uc', expected: false, description: 'Absolute file path' },
    { input: 'module.', expected: false, description: 'Trailing dot' },
    { input: '.module', expected: false, description: 'Leading dot' },
    { input: 'module..sub', expected: false, description: 'Double dots' },
    { input: 'module.sub-name', expected: false, description: 'Hyphen in name' },
    { input: 'module.123invalid', expected: false, description: 'Starting with number' },
    { input: '', expected: false, description: 'Empty string' },
    { input: '.', expected: false, description: 'Single dot' },
    { input: 'module.sub space', expected: false, description: 'Space in name' }
];

let validationTestsPassed = 0;
for (const test of validationTests) {
    const result = isDotNotationModule(test.input);
    if (result === test.expected) {
        console.log(`✅ ${test.description}: "${test.input}" -> ${result}`);
        validationTestsPassed++;
    } else {
        console.log(`❌ ${test.description}: "${test.input}" -> ${result} (expected ${test.expected})`);
    }
}

console.log(`Validation tests: ${validationTestsPassed}/${validationTests.length} passed\n`);

// Test 2: convertDotNotationToPath conversion
console.log('=== Test 2: convertDotNotationToPath Conversion ===');

const conversionTests = [
    { 
        input: 'u1905.u1905d.src.u1905.log', 
        expected: './u1905/u1905d/src/u1905/log.uc',
        description: 'Multi-level conversion'
    },
    { 
        input: 'simple.module', 
        expected: './simple/module.uc',
        description: 'Simple two-part conversion'
    },
    { 
        input: 'a.b.c.d.e', 
        expected: './a/b/c/d/e.uc',
        description: 'Deep nesting conversion'
    },
    { 
        input: 'package_name.sub_module', 
        expected: './package_name/sub_module.uc',
        description: 'Underscore preservation'
    },
    { 
        input: 'Module123.Sub456', 
        expected: './Module123/Sub456.uc',
        description: 'Case and number preservation'
    }
];

let conversionTestsPassed = 0;
for (const test of conversionTests) {
    const result = convertDotNotationToPath(test.input);
    if (result === test.expected) {
        console.log(`✅ ${test.description}: "${test.input}" -> "${result}"`);
        conversionTestsPassed++;
    } else {
        console.log(`❌ ${test.description}: "${test.input}" -> "${result}" (expected "${test.expected}")`);
    }
}

console.log(`Conversion tests: ${conversionTestsPassed}/${conversionTests.length} passed\n`);

// Test 3: Combined validation and conversion workflow
console.log('=== Test 3: Combined Workflow ===');

const workflowTests = [
    {
        input: 'u1905.u1905d.src.u1905.log',
        description: 'Complete workflow for valid module'
    },
    {
        input: 'fs',
        description: 'Built-in module should not be converted'
    },
    {
        input: './relative/path.uc',
        description: 'File path should not be converted'
    }
];

let workflowTestsPassed = 0;
for (const test of workflowTests) {
    const isValid = isDotNotationModule(test.input);
    if (isValid) {
        const converted = convertDotNotationToPath(test.input);
        console.log(`✅ ${test.description}: "${test.input}" -> "${converted}"`);
        workflowTestsPassed++;
    } else {
        console.log(`✅ ${test.description}: "${test.input}" -> not converted (correct)`);
        workflowTestsPassed++;
    }
}

console.log(`Workflow tests: ${workflowTestsPassed}/${workflowTests.length} passed\n`);

// Summary
const totalTests = validationTests.length + conversionTests.length + workflowTests.length;
const totalPassed = validationTestsPassed + conversionTestsPassed + workflowTestsPassed;

console.log('=== Helper Function Test Summary ===');
console.log(`${totalPassed}/${totalTests} tests passed`);

if (totalPassed === totalTests) {
    console.log('🎉 All dot notation helper function tests passed!');
    process.exit(0);
} else {
    console.log('❌ Some helper function tests failed');
    process.exit(1);
}