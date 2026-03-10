// Comprehensive test runner for all validation unit tests
import { test, expect } from 'bun:test';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

// List of all test files to run
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
    'tests/test-system-utility-functions.js',
    'tests/test-union-types-programmatic.js',
    'tests/test-union-types-logic.js',
    'tests/test-union-types-enhanced.js',
    'tests/test-unknown-return-types.js',
    'tests/test-arrow-function-parsing.js',
    'tests/test-for-in-bare-fix.js',
    'tests/test-imported-function-fix.js',
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
    'tests/test-io-module.js',
    'tests/test-io-hover.js',
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
    'tests/test-default-export-imports.js',
    'tests/test-module-imports.js',
    'tests/test-object-method-hover.js',
    'tests/test-multi-level-completions.js',
    'tests/test-dot-notation-helpers.js',
    'tests/test-dot-notation-namespace-imports.js',
    'tests/test-namespace-import-file-existence.js',
    'tests/test-dot-notation-default-import.js',
    'tests/test-global-object-types.js',
    'tests/test-module-aliasing.js',
    'tests/test-object-property-hover-lsp.mocha.js',
    'tests/test-type-guard-narrowing-bug.js',
    'tests/test-call-chain-completions.js',
    'tests/test-printf-format-diagnostics.js',
    'tests/test-unreachable-code.js',
    'tests/test-object-property-inference.js',
    'tests/test-pbr-cross-file-inference.js',
    'tests/test-equality-narrowing-hover.mocha.js',
];

// Mocha test files (run as a single combined mocha invocation with shared LSP server)
const mochaFileSet = new Set([
    'test-dot-notation-default-import.js',
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
    'test-type-guard-narrowing-bug.js',
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
    'test-default-export-imports.js',
    'test-module-imports.js',
    'test-rest-parameters-lsp.js',
    'test-object-method-hover.js',
    'test-multi-level-completions.js',
    'test-dot-notation-namespace-imports.js',
    'test-namespace-import-file-existence.js',
    'test-global-object-types.js',
    'test-module-aliasing.js',
    'test-object-property-hover-lsp.mocha.js',
    'test-call-chain-completions.js',
    'test-printf-format-diagnostics.js',
    'test-unreachable-code.js',
    'test-object-property-inference.js',
    'test-pbr-cross-file-inference.js',
    'test-equality-narrowing-hover.mocha.js',
]);

function getBaseName(filePath) {
    return filePath.substring(filePath.lastIndexOf('/') + 1);
}

test('Comprehensive Validation Test Suite', async () => {
    console.log('Running Comprehensive Validation Test Suite\n');
    console.log('='.repeat(60));

    let totalSuites = 0;
    let passedSuites = 0;
    let totalTestCount = 0;

    // First, run shared LSP tests (function return type tests)
    console.log('\nRunning Shared LSP Tests (Fast)...\n');

    try {
        const { createLSPTestServer } = require('./lsp-test-helpers');
        const lspServer = createLSPTestServer();
        await lspServer.initialize();

        const { runFunctionReturnTypeTests } = require('./test-function-return-types-shared');
        const functionTestsResult = await runFunctionReturnTypeTests(lspServer);

        totalSuites++;
        if (functionTestsResult) {
            passedSuites++;
            console.log('  Shared LSP Function Return Type Tests: PASSED');
        } else {
            console.log('  Shared LSP Function Return Type Tests: FAILED');
        }

        lspServer.shutdown();
    } catch (error) {
        console.log(`  Shared LSP tests failed: ${error.message}`);
        totalSuites++;
    }

    // Separate test files into mocha vs non-mocha
    const mochaTestPaths = [];
    const nonMochaTestFiles = [];

    for (const testFile of testFiles) {
        if (!fs.existsSync(testFile)) {
            console.log(`  Test file ${testFile} not found, skipping...`);
            continue;
        }
        if (mochaFileSet.has(getBaseName(testFile))) {
            mochaTestPaths.push(testFile);
        } else {
            nonMochaTestFiles.push(testFile);
        }
    }

    // --- Run all mocha tests in a single invocation with shared LSP server ---
    if (mochaTestPaths.length > 0) {
        console.log(`\nRunning ${mochaTestPaths.length} mocha test suites (shared LSP server)...\n`);

        const mochaCmd = [
            './node_modules/.bin/mocha',
            '--require', 'tests/mocha-shared-setup.js',
            '--timeout', '30000',
            '--reporter', 'min',
            ...mochaTestPaths
        ].join(' ');

        let mochaOutput = '';
        let mochaExitOk = false;

        try {
            mochaOutput = execSync(mochaCmd, { encoding: 'utf8', timeout: 90000 });
            mochaExitOk = true;
        } catch (error) {
            // mocha exits non-zero on test failures but still writes output to stdout
            mochaOutput = error.stdout || '';
        }

        // Parse "N passing" and "N failing" from mocha min reporter
        const passingMatch = mochaOutput.match(/(\d+) passing/);
        const failingMatch = mochaOutput.match(/(\d+) failing/);
        const mochaPasses = passingMatch ? parseInt(passingMatch[1]) : 0;
        const mochaFailures = failingMatch ? parseInt(failingMatch[1]) : 0;
        totalTestCount += mochaPasses + mochaFailures;
        totalSuites += mochaTestPaths.length;

        if (mochaExitOk && mochaFailures === 0) {
            passedSuites += mochaTestPaths.length;
            console.log(`  All ${mochaTestPaths.length} mocha suites passed (${mochaPasses} tests)\n`);
        } else if (mochaFailures > 0) {
            // Estimate failed suites from failure count (conservative: at least 1 suite failed)
            const failedSuiteCount = Math.min(mochaFailures, mochaTestPaths.length);
            passedSuites += mochaTestPaths.length - failedSuiteCount;
            console.log(`  Mocha: ${mochaPasses} passed, ${mochaFailures} failed\n`);
            // Show failure details from the output
            const failureSection = mochaOutput.substring(mochaOutput.indexOf('failing'));
            if (failureSection) {
                console.log(failureSection.substring(0, 2000));
            }
        } else {
            // No passing/failing match found but exit was ok - assume all passed
            if (mochaExitOk) {
                passedSuites += mochaTestPaths.length;
                console.log(`  All ${mochaTestPaths.length} mocha suites passed\n`);
            } else {
                console.log('  Mocha invocation failed');
                console.log(mochaOutput.substring(0, 1000));
            }
        }
    }

    // --- Run non-mocha (bun) tests in parallel ---
    if (nonMochaTestFiles.length > 0) {
        console.log(`Running ${nonMochaTestFiles.length} bun test suites (parallel)...\n`);

        totalSuites += nonMochaTestFiles.length;

        const bunResults = await Promise.all(nonMochaTestFiles.map(async (testFile) => {
            const command = `bun ${testFile}`;
            try {
                const { stdout } = await execAsync(command, { encoding: 'utf8', timeout: 30000 });
                return { testFile, stdout, ok: true };
            } catch (error) {
                return { testFile, stdout: error.stdout || error.message, ok: false };
            }
        }));

        for (const { testFile, stdout, ok } of bunResults) {
            if (!ok) {
                console.log(`  FAILED with error - ${testFile}`);
                console.log(stdout);
                continue;
            }

            const bunPassedMatch = stdout.match(/(\d+)\/(\d+) tests passed/);
            if (bunPassedMatch) {
                const passed = parseInt(bunPassedMatch[1]);
                const total = parseInt(bunPassedMatch[2]);
                totalTestCount += total;
                if (passed === total && total !== 0) {
                    passedSuites++;
                } else {
                    console.log(`  FAILED: ${passed}/${total} tests - ${testFile}`);
                    console.log(stdout);
                }
            } else {
                passedSuites++; // Assume pass if no failures detected
            }
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('FINAL TEST RESULTS');
    console.log('='.repeat(60));

    if (passedSuites === totalSuites) {
        console.log('\nALL VALIDATION TEST SUITES PASSED!');
    } else {
        console.log('\nSome test suites failed. Please review the output above.');
    }

    console.log('\nThese tests validate the core logic of our uCode built-in function validations.');
    console.log('For full integration testing, use the .uc test files in VS Code with the extension.\n');

    console.log(`Test Suites: ${passedSuites}/${totalSuites} passed`);
    console.log(`Total Tests: ${totalTestCount} executed\n`);

    // Assert that all test suites passed
    expect(passedSuites).toBe(totalSuites);
    expect(totalTestCount).toBeGreaterThan(0);
}, { timeout: 120000 });
