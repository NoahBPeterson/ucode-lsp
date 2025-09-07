// Comprehensive test runner for all validation unit tests
import { test, expect } from 'bun:test';
import { execSync } from 'child_process';
import fs from 'fs';

// List of test files to run
const testFiles = [
    'tests/test-simple-validation.js',
    'tests/test-array-validations.js', 
    'tests/test-new-validations-unit.js',
    'tests/test-trim-validations-real.js',
    'tests/test-encoding-io-functions.js',
    'tests/test-system-functions.js',
    'tests/test-utility-functions.js',
    'tests/test-datetime-functions.js',
    'tests/test-network-functions.js',
    'tests/test-conversion-functions.js',
    'tests/test-module-functions.js',
    'tests/test-json-utility-functions.js',
    'tests/test-utility-functions-ast.test.js',
    'tests/test-system-utility-functions.js',
    'tests/test-union-types-programmatic.js',
    'tests/test-union-types-logic.js',
    'tests/test-union-types-enhanced.js',
    'tests/test-unknown-return-types.js',
    'tests/test-arrow-function-parsing.js',
    'tests/test-for-in-bare-fix.js',
    'tests/test-imported-function-fix.js',
    'tests/test-object-property-keys.test.js',
    'tests/test-object-property-keys-fix.js',
    'tests/test-namespace-import-validation.js',
    'tests/test-fs-module-support.js',
    'tests/test-fs-undefined-diagnostics.js',
    'tests/test-fs-method-diagnostics.js',
    'tests/test-fs-types.js',
    'tests/test-fs-object-completion.js',
    'tests/test-open-builtin-diagnostics.js',
    'tests/test-completion-detection.js',
    'tests/test-completion-simple.js',
    'tests/test-in-token.js',
    'tests/test-lexer.js',
    'tests/test-parser.js',
    'tests/test-go-to-definition.js',
    'tests/test-import-simple.js',
    'tests/test-export-debug.js',
    'tests/test-for-in-debug.js',
    'tests/test-refactor.js',
    'tests/test-new-validations.js',
    'tests/test-validations-only.js',
    'tests/test-log-module.js',
    'tests/test-error-constants.js',
    'tests/test-log-import-validation.js',
    'tests/test-log-constant-hover.js',
    'tests/test-math-module.js',
    'tests/test-math-import-validation.js',
    'tests/test-math-alias-hover.js',
    'tests/test-nl80211-module.js',
    'tests/test-resolv-module.js',
    'tests/test-resolv-import-validation.js',
    'tests/test-socket-module.js',
    'tests/test-socket-import-validation.js',
    'tests/test-struct-module.js',
    'tests/test-ubus-module.js',
    'tests/test-uci-module.js',
    'tests/test-uloop-module.js',
    'tests/test-string-method-validation.js',
    'tests/test-missing-builtins-validation.js',
    'tests/test-filter-builtin-validation.js',
    'tests/test-split-regex-validation.js',
    'tests/test-fuzz-integration.js',
    'tests/test-zlib-module.js',
    'tests/test-clock-function.js',
    'tests/test-optional-chaining-lexer.js',
    'tests/test-optional-chaining-statements.js',
    'tests/test-regex-flags.js',
    'tests/test-object-spread-parsing.js',
    'tests/test-trailing-comma.js',
    'tests/test-comma-operator-parsing.js',
    'tests/test-comma-operator-lsp.js',
    'tests/test-rtnl-constants.js',
    'tests/test-combined-lsp-validations.js',
    'tests/test-fs-import-validation.js',
    'tests/test-error-code-integration.js',
    'tests/test-disable-comments.js',
    'tests/test-auto-fix-code-actions.js',
    'tests/test-disable-parser-diagnostics.js',
    'tests/test-nlresult-specific.js',
    'tests/test-disable-comments-warnings.js',
    'tests/test-conversion-functions-validation.js',
    'tests/test-module-functions-validation.js',
    'tests/test-number-conversion-validation.js',
    'tests/test-array-functions-ast.js',
    'tests/test-object-functions-ast.js',
    'tests/test-trim-functions-ast.js',
    'tests/test-substr-functions-ast.js',
    'tests/test-import-completion.js',
    'tests/test-module-completions.js',
    'tests/test-destructured-import-completion.js',
    'tests/test-multiple-imports-completion.js',
    'tests/test-trigger-completions.js',
    'tests/test-exclusion-completions.js',
    'tests/test-nl80211-fallback.js',
    'tests/test-alphanumeric-triggers.js',
    'tests/test-completion-sorting.js',
    'tests/test-object-property-hover-bug.js',
    'tests/test-variable-hover-consistency-bug.js',
    'tests/test-semantic-analysis-timing.js',
    'tests/test-builtin-shadowing.js',
];

const mochaFiles = [
    'test-string-method-validation.js',
    'test-missing-builtins-validation.js',
    'test-filter-builtin-validation.js',
    'test-split-regex-validation.js',
    'test-uloop-module.js',
    'test-comma-operator-lsp.js',
    'test-rtnl-constants.js',
    'test-combined-lsp-validations.js',
    'test-object-functions-ast.js',
    'test-fs-import-validation.js',
    'test-error-code-integration.js',
    'test-disable-comments.js',
    'test-auto-fix-code-actions.js',
    'test-disable-parser-diagnostics.js',
    'test-nlresult-specific.js',
    'test-disable-comments-warnings.js',
    'test-conversion-functions-validation.js',
    'test-module-functions-validation.js',
    'test-number-conversion-validation.js',
    'test-trim-functions-ast.js',
    'test-substr-functions-ast.js',
    'test-import-completion.js',
    'test-module-completions.js',
    'test-destructured-import-completion.js',
    'test-multiple-imports-completion.js',
    'test-trigger-completions.js',
    'test-exclusion-completions.js',
    'test-nl80211-fallback.js',
    'test-alphanumeric-triggers.js',
    'test-completion-sorting.js',
    'test-object-property-hover-bug.js',
    'test-variable-hover-consistency-bug.js',
    'test-semantic-analysis-timing.js',
    'test-builtin-shadowing.js',
];

test('Comprehensive Validation Test Suite', async () => {
    console.log('🚀 Running Comprehensive Validation Test Suite\n');
    console.log('='.repeat(60));

    let totalSuites = 0;
    let passedSuites = 0;
    let totalTestCount = 0;

    for (const [index, testFile] of testFiles.entries()) {
        if (!fs.existsSync(testFile)) {
            console.log(`⚠️  Test file ${testFile} not found, skipping...`);
            continue;
        }
        
        totalSuites++;
        console.log(`\n📋 Running Test Suite ${index + 1}: ${testFile}`);
        console.log('-'.repeat(50));
        
        try {
            // Use different command for mocha tests
            const isMochaTest = mochaFiles.includes(testFile.substring(testFile.indexOf('/')+1));
            const timeout = testFile.includes('test-missing-builtins-validation.js') ? '20000' : '15000';
            const command = isMochaTest 
                ? `./node_modules/.bin/mocha ${testFile} --timeout ${timeout}`
                : `bun ${testFile}`;
            
            const output = execSync(command, { encoding: 'utf8' });
            //console.log(output);
            
            // Parse test results from output - handle both bun and mocha formats
            const bunPassedMatch = output.match(/(\d+)\/(\d+) tests passed/);
            const mochaPassedMatch = output.match(/(\d+) passing/);
            const mochaFailedMatch = output.match(/(\d+) failing/);
            
            if (bunPassedMatch) {
                const passed = parseInt(bunPassedMatch[1]);
                const total = parseInt(bunPassedMatch[2]);
                totalTestCount += total;
                
                if (passed === total) {
                    passedSuites++;
                    console.log(`✅ Suite ${index + 1} PASSED: ${passed}/${total} tests`);
                } else {
                    console.log(output);
                    console.log(`❌ Suite ${index + 1} FAILED: ${passed}/${total} tests`);
                }
            } else if (mochaPassedMatch) {
                const passed = parseInt(mochaPassedMatch[1]);
                const failed = mochaFailedMatch ? parseInt(mochaFailedMatch[1]) : 0;
                const total = passed + failed;
                totalTestCount += total;
                
                if (failed === 0) {
                    passedSuites++;
                    console.log(`✅ Suite ${index + 1} PASSED: ${passed} tests`);
                } else {
                    console.log(output);
                    console.log(`❌ Suite ${index + 1} FAILED: ${passed} passed, ${failed} failed`);
                }
            } else {
                console.log(`✅ Suite ${index + 1} completed (format may vary)`);
                passedSuites++; // Assume pass if no failures detected
            }
            
        } catch (error) {
            console.log(`❌ Suite ${index + 1} FAILED with error:`);
            console.log(error.stdout || error.message);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL TEST RESULTS');
    console.log('='.repeat(60));

    if (passedSuites === totalSuites) {
        console.log('\n🎉 ALL VALIDATION TEST SUITES PASSED! 🎉');
    } else {
        console.log('\n❌ Some test suites failed. Please review the output above.');
    }

    console.log('\n💡 These tests validate the core logic of our uCode built-in function validations.');
    console.log('   For full integration testing, use the .uc test files in VS Code with the extension.\n\n');

    console.log(`Test Suites: ${passedSuites}/${totalSuites} passed`);
    console.log(`Total Tests: ${totalTestCount} executed\n`);

    // Assert that all test suites passed
    expect(passedSuites).toBe(totalSuites);
    expect(totalTestCount).toBeGreaterThan(0);
}, { timeout: 60000 });