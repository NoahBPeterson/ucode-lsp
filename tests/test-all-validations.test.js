// Comprehensive test runner for all validation unit tests.
//
// DISCOVERY IS AUTOMATIC. This bridge globs every suite under tests/ and runs it
// (mocha suites in one shared-server invocation; standalone bun scripts via `bun
// <file>`). `bun test` itself only discovers *.test.js / *.spec.js names, so the
// hundreds of describe/it (mocha) and standalone bun scripts here would otherwise
// never run in CI — this file is what pulls them in. A NEW test file is picked up
// with no registration; to KEEP one out, add it to QUARANTINE below. (Previously
// this was two hand-maintained lists, which silently orphaned any unlisted file.)
import { test, expect } from 'bun:test';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

const TESTS_DIR = 'tests';

// Files the glob finds but must NOT run. Both categories are PRE-EXISTING (none were
// in the old curated list). They are fix-or-delete candidates: repair one and simply
// remove it here to enroll it. Keep this list SMALL — it is the only opt-out.
const QUARANTINE = new Set([
    // (a) Currently FAILING / crashing when run — would turn CI red. Triaged 2026-06-22.
    'test-array-element-types.js',
    'test-exception-types.js',
    'test-hover-debug.js',
    'test-hover-direct.js',
    'test-import-parsing.js',
    'test-nl80211-import-validation.js',
    'test-rest-parameters.js',
    'test-rtnl-module-completion.js',
    'test-rtnl-union-types.js',
    'test-stray-slash-parser-error.js',
    'test-uloop-delete-methods.js',
    'test-uloop-type-inference.js',
    // (b) Scratch/debug scripts that make NO assertions (emit no "N/N tests passed"
    //     marker) — they execute analyzer code but assert nothing, so they are not
    //     real suites. Promote one by giving it real assertions, then remove it here.
    'test-assignment-type-inference.js',
    'test-catch-parseInt-fix.js',
    'test-debug-module.js',
    'test-equality-narrowing.js',
    'test-export-parsing.js',
    'test-final-comprehensive.js',
    'test-fs-completion-integration.js',
    'test-fs-member-expression-errors.js',
    'test-hover-fs-types.js',
    'test-multiple-semicolon-errors.js',
    'test-multiple-semicolon-simple.js',
    'test-normal-regex.js',
    'test-parser-error-location.js',
    'test-simple-assignment-debug.js',
    'test-stray-slash-context.js',
    'test-stray-slash-fix.js',
    'test-stray-slash-simple.js',
    'test-type-inference.js',
    'test-union-types.js',
]);

// Auto-discover suites: tests/test-*.js, EXCLUDING
//   - *.test.js   → discovered & run directly by `bun test` (incl. THIS bridge file),
//                   so re-running them here would double-run and recurse.
//   - *-shared.js → imported helper modules, not standalone suites.
//   - QUARANTINE  → known-broken / scratch (see above).
const testFiles = fs.readdirSync(TESTS_DIR)
    .filter((f) => /^test-.*\.js$/.test(f) && !/\.test\.js$/.test(f) && !/-shared\.js$/.test(f))
    .filter((f) => !QUARANTINE.has(f))
    .sort()
    .map((f) => `${TESTS_DIR}/${f}`);

// Classify a suite as MOCHA (describe/it — run via the shared mocha invocation) vs a
// standalone BUN script (run via `bun <file>`): a mocha suite uses describe() and does
// NOT import bun:test. This heuristic was verified to reproduce the previous hand-
// curated 103-entry mochaFileSet exactly (0 mismatches across all listed files).
function isMochaFile(fullPath) {
    const c = fs.readFileSync(fullPath, 'utf8');
    const usesDescribe = /\bdescribe\s*\(/.test(c);
    const importsBunTest = /from ['"]bun:test['"]/.test(c) || /require\(['"]bun:test['"]\)/.test(c);
    return usesDescribe && !importsBunTest;
}

test('Comprehensive Validation Test Suite', async () => {
    console.log('Running Comprehensive Validation Test Suite\n');
    console.log('='.repeat(60));
    console.log(`Auto-discovered ${testFiles.length} suites (${QUARANTINE.size} quarantined)`);

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
        if (isMochaFile(testFile)) {
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
}, { timeout: 180000 });
