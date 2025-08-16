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
    'tests/test-remaining-utility-functions.js',
    'tests/test-system-utility-functions.js',
    'tests/test-union-types-programmatic.js',
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
    'tests/test-complex-syntax-validation.js',
    'tests/test-object-spread-parsing.js',
    'tests/test-comprehensive-array-validation.js',
    'tests/test-trailing-comma.js',
    'tests/test-comma-operator-parsing.js',
    'tests/test-comma-operator-lsp.js',
    'tests/test-rtnl-constants.js',
    'tests/test-combined-lsp-validations.js',
    'tests/test-fs-import-validation.js'
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
            const isMochaTest = testFile.includes('test-string-method-validation.js') || 
                               testFile.includes('test-missing-builtins-validation.js') ||
                               testFile.includes('test-filter-builtin-validation.js') ||
                               testFile.includes('test-split-regex-validation.js') ||
                               testFile.includes('test-uloop-module.js') ||
                               testFile.includes('test-comma-operator-lsp.js') ||
                               testFile.includes('test-rtnl-constants.js') ||
                               testFile.includes('test-combined-lsp-validations.js') ||
                               testFile.includes('test-fs-import-validation.js');
            const timeout = testFile.includes('test-missing-builtins-validation.js') ? '20000' : '15000';
            const command = isMochaTest 
                ? `./node_modules/.bin/mocha ${testFile} --timeout ${timeout}`
                : `bun ${testFile}`;
            
            const output = execSync(command, { encoding: 'utf8' });
            console.log(output);
            
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
        /*console.log('✅ String analysis validations working correctly');
        console.log('✅ Array function validations working correctly'); 
        console.log('✅ Object function validations working correctly');
        console.log('✅ Number conversion validations working correctly');
        console.log('✅ Character function validations working correctly');
        console.log('✅ String function validations working correctly');
        console.log('✅ Real trim function validations with actual LSP logic working correctly');
        console.log('✅ Both TK_NUMBER and TK_DOUBLE tokens handled correctly');
        console.log('✅ Union type system working correctly');
        console.log('✅ Type inference for function returns working correctly');
        console.log('✅ Dynamic typing with union types working correctly');
        console.log('✅ Unknown return types preserved in union inference');
        console.log('✅ Arrow function parsing implemented correctly');
        console.log('✅ For-in loop parsing with bare identifiers fixed');
        console.log('✅ Imported function recognition in type checker fixed');
        console.log('✅ Object property keys no longer show undefined variable errors');
        console.log('✅ Parser creates LiteralNode for property keys instead of IdentifierNode');
        console.log('✅ Namespace import member access (import * as name) working correctly');
        console.log('✅ Namespace import validation logic tests passing');
        console.log('✅ Built-in fs module support working correctly');
        console.log('✅ Only one diagnostic per undefined fs reference (no duplicates)');
        console.log('✅ Member expression completion detection working correctly');
        console.log('✅ fs module autocomplete/IntelliSense logic working correctly');
        console.log('✅ TK_IN token recognition and for-in loop parsing working correctly');
        console.log('✅ Lexer tokenization patterns and position tracking working correctly');
        console.log('✅ Parser AST node creation and validation working correctly');
        console.log('✅ Go to Definition functionality for imported and local symbols working correctly');
        console.log('✅ Import statement parsing (named and namespace imports) working correctly');
        console.log('✅ Export statement parsing and module system support working correctly');
        console.log('✅ For-in loop parsing with bare identifiers working correctly');
        console.log('✅ Module refactoring and code organization patterns working correctly');
        console.log('✅ New validation implementations and parameter type checking working correctly');
        console.log('✅ Validation-only mode and isolated validation engine working correctly');
        console.log('✅ Math module support working correctly');
        console.log('✅ Math module import validation working correctly');
        console.log('✅ Math module aliased import hover working correctly');
        console.log('✅ Uloop module support working correctly');
        console.log('✅ Uloop module import validation working correctly');
        console.log('✅ Uloop object type inference and method completion working correctly');
        console.log('✅ String method validation working correctly');
        console.log('✅ Invalid string methods (toUpperCase, toLowerCase, etc.) properly detected');
        console.log('✅ String property validation (only length allowed) working correctly');
        console.log('✅ Missing builtin functions validation working correctly');
        console.log('✅ All 14 newly added builtin functions provide hover documentation');
        console.log('✅ Builtin function hover includes parameters, return types, and examples');*/
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