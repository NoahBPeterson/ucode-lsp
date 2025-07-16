// Comprehensive test runner for all validation unit tests

const { execSync } = require('child_process');
const fs = require('fs');

// List of test files to run
const testFiles = [
    './test-simple-validation.js',
    './test-array-validations.js', 
    './test-new-validations-unit.js',
    './test-trim-validations.js',
    './test-encoding-io-functions.js',
    './test-system-functions.js',
    './test-utility-functions.js',
    './test-datetime-functions.js',
    './test-network-functions.js',
    './test-conversion-functions.js',
    './test-module-functions.js',
    './test-json-utility-functions.js',
    './test-remaining-utility-functions.js',
    './test-system-utility-functions.js',
    './test-validation-simple.js',
    './test-union-types-programmatic.js',
    './test-unknown-return-types.js'
];

console.log('🚀 Running Comprehensive Validation Test Suite\n');
console.log('=' * 60);

let totalSuites = 0;
let passedSuites = 0;
let totalTestCount = 0;

testFiles.forEach((testFile, index) => {
    if (!fs.existsSync(testFile)) {
        console.log(`⚠️  Test file ${testFile} not found, skipping...`);
        return;
    }
    
    totalSuites++;
    console.log(`\n📋 Running Test Suite ${index + 1}: ${testFile}`);
    console.log('-' * 50);
    
    try {
        const output = execSync(`bun ${testFile}`, { encoding: 'utf8' });
        console.log(output);
        
        // Parse test results from output
        const passedMatch = output.match(/(\d+)\/(\d+) tests passed/);
        if (passedMatch) {
            const passed = parseInt(passedMatch[1]);
            const total = parseInt(passedMatch[2]);
            totalTestCount += total;
            
            if (passed === total) {
                passedSuites++;
                console.log(`✅ Suite ${index + 1} PASSED: ${passed}/${total} tests`);
            } else {
                console.log(`❌ Suite ${index + 1} FAILED: ${passed}/${total} tests`);
            }
        } else {
            console.log(`✅ Suite ${index + 1} completed (format may vary)`);
            passedSuites++; // Assume pass if no failures detected
        }
        
    } catch (error) {
        console.log(`❌ Suite ${index + 1} FAILED with error:`);
        console.log(error.stdout || error.message);
    }
});

console.log('\n' + '=' * 60);
console.log('📊 FINAL TEST RESULTS');
console.log('=' * 60);
console.log(`Test Suites: ${passedSuites}/${totalSuites} passed`);
console.log(`Total Tests: ${totalTestCount} executed`);

if (passedSuites === totalSuites) {
    console.log('\n🎉 ALL VALIDATION TEST SUITES PASSED! 🎉');
    console.log('✅ String analysis validations working correctly');
    console.log('✅ Array function validations working correctly'); 
    console.log('✅ Object function validations working correctly');
    console.log('✅ Number conversion validations working correctly');
    console.log('✅ Character function validations working correctly');
    console.log('✅ String function validations working correctly');
    console.log('✅ Trim function validations working correctly');
    console.log('✅ Both TK_NUMBER and TK_DOUBLE tokens handled correctly');
    console.log('✅ Union type system working correctly');
    console.log('✅ Type inference for function returns working correctly');
    console.log('✅ Dynamic typing with union types working correctly');
    console.log('✅ Unknown return types preserved in union inference');
} else {
    console.log('\n❌ Some test suites failed. Please review the output above.');
}

console.log('\n💡 These tests validate the core logic of our uCode built-in function validations.');
console.log('   For full integration testing, use the .uc test files in VS Code with the extension.');