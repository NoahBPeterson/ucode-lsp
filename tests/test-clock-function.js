// Test for clock function with optional boolean parameter
console.log('🧪 Testing Clock Function Improvements...\n');

const { TypeChecker } = require('../src/analysis/typeChecker');
const { SymbolTable } = require('../src/analysis/symbolTable');

function testClockFunction() {
    let passedTests = 0;
    let totalTests = 0;

    console.log('🧪 Testing clock function signature and return type:');
    
    const symbolTable = new SymbolTable();
    const typeChecker = new TypeChecker(symbolTable);
    
    // Test 1: Check if clock function exists in builtin functions
    totalTests++;
    const clockBuiltin = typeChecker.builtinFunctions?.get('clock');
    if (clockBuiltin) {
        console.log('  ✅ PASS: clock function found in builtins');
        passedTests++;
    } else {
        console.log('  ❌ FAIL: clock function not found in builtins');
    }
    
    // Test 2: Check clock function signature
    totalTests++;
    if (clockBuiltin) {
        const hasOptionalParam = clockBuiltin.minParams === 0 && clockBuiltin.maxParams === 1;
        if (hasOptionalParam) {
            console.log('  ✅ PASS: clock function has optional parameter (0-1 params)');
            passedTests++;
        } else {
            console.log(`  ❌ FAIL: clock function param count incorrect (min: ${clockBuiltin.minParams}, max: ${clockBuiltin.maxParams})`);
        }
    } else {
        console.log('  ❌ FAIL: cannot test signature - function not found');
    }
    
    // Test 3: Check return type
    totalTests++;
    if (clockBuiltin) {
        const correctReturnType = clockBuiltin.returnType === 'array';
        if (correctReturnType) {
            console.log('  ✅ PASS: clock function returns array type');
            passedTests++;
        } else {
            console.log(`  ❌ FAIL: clock function return type incorrect (got: ${clockBuiltin.returnType})`);
        }
    } else {
        console.log('  ❌ FAIL: cannot test return type - function not found');
    }
    
    // Test 4: Check parameter type
    totalTests++;
    if (clockBuiltin) {
        const correctParamType = clockBuiltin.parameters[0] === 'boolean';
        if (correctParamType) {
            console.log('  ✅ PASS: clock function accepts boolean parameter');
            passedTests++;
        } else {
            console.log(`  ❌ FAIL: clock function parameter type incorrect (got: ${clockBuiltin.parameters[0]})`);
        }
    } else {
        console.log('  ❌ FAIL: cannot test parameter type - function not found');
    }

    console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
        console.log('🎉 All clock function tests passed!');
        return true;
    } else {
        console.log('❌ Some clock function tests failed!');
        return false;
    }
}

// Run the test
const success = testClockFunction();
process.exit(success ? 0 : 1);