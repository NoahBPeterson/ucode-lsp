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
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const TESTS_DIR = 'tests';

// Files the glob finds but must NOT run. Empty by design: a quarantined file is
// untested code. The 31 pre-existing entries here were triaged 2026-06-22 — 30 deleted
// (scratch console.log scripts or redundant with passing tests) and 1 fixed
// (test-array-element-types.js had stale `array | null` expectations). The fs-flow gap
// two of them probed is now characterized by tests/test-fs-flow-reassignment.test.js +
// docs/done/flow-reassignment-union-call-gap.md. Keep this empty: fix or delete, never quarantine.
const QUARANTINE = new Set([]);

// Auto-discover suites by walking tests/ RECURSIVELY (suites now live in feature
// subdirs: tests/<category>/test-*.js). EXCLUDING:
//   - *.test.js   → discovered & run directly by `bun test` (incl. THIS bridge file),
//                   so re-running them here would double-run and recurse.
//   - *-shared.js → imported helper modules, not standalone suites.
//   - fixtures/, scratch/, module_tests/, u1905/, node_modules/ → no runnable suites
//     (sample .uc inputs and non-run debug scripts).
//   - QUARANTINE  → empty by design (a quarantined file is untested code).
const SKIP_DIRS = new Set(['fixtures', 'scratch', 'module_tests', 'u1905', 'node_modules']);
function discoverSuites(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...discoverSuites(p)); }
        else if (/^test-.*\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && !/-shared\.js$/.test(e.name)
                 && !QUARANTINE.has(e.name)) out.push(p);
    }
    return out;
}
const testFiles = discoverSuites(TESTS_DIR).sort();

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

    // --- Launch BOTH heavy phases concurrently ---------------------------------
    // The mocha invocation (1 process, shared LSP server, ~10s) and the standalone
    // bun-script pool are independent process trees; running them side by side
    // makes the wall-clock max(mocha, pool) instead of the sum. Each phase only
    // COLLECTS results here; parsing/reporting stays sequential below so the
    // output and pass/fail accounting are unchanged.
    const mochaPhase = (async () => {
        if (mochaTestPaths.length === 0) return null;
        const t0 = Date.now();
        // SHARDED: every suite here was written to run standalone (they each
        // originally spawned their own server), so any partition is valid.
        // Three concurrent mocha processes — each with its own shared LSP
        // server via the root hook — cut the phase's wall-clock to ~max(shard)
        // instead of the sum. Round-robin keeps slow suites spread out.
        const SHARDS = Math.min(3, mochaTestPaths.length);
        console.log(`\nRunning ${mochaTestPaths.length} mocha test suites (${SHARDS} shards, shared LSP server each)...`);
        const shards = Array.from({ length: SHARDS }, () => []);
        mochaTestPaths.forEach((p, i) => shards[i % SHARDS].push(p));
        const shardResults = await Promise.all(shards.map(async (files) => {
            const cmd = [
                './node_modules/.bin/mocha',
                '--require', 'tests/mocha-shared-setup.js',
                '--timeout', '30000',
                '--reporter', 'min',
                ...files
            ].join(' ');
            try {
                const { stdout } = await execAsync(cmd, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
                return { output: stdout, exitOk: true };
            } catch (error) {
                // mocha exits non-zero on test failures but still writes output to stdout
                return { output: error.stdout || '', exitOk: false };
            }
        }));
        console.log(`  [mocha phase: ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
        // Combine shard outputs: sum the min-reporter pass/fail counts, keep
        // every shard's failure detail for the report below.
        let passes = 0, failures = 0, exitOk = true, failText = '';
        for (const r of shardResults) {
            const p = r.output.match(/(\d+) passing/);
            const f = r.output.match(/(\d+) failing/);
            passes += p ? parseInt(p[1]) : 0;
            const fl = f ? parseInt(f[1]) : 0;
            failures += fl;
            if (!r.exitOk) exitOk = false;
            if (fl > 0) failText += r.output.substring(r.output.indexOf('failing')) + '\n';
        }
        return { passes, failures, exitOk, failText };
    })();

    const poolPhase = (async () => {
        if (nonMochaTestFiles.length === 0) return [];
        // Bounded worker pool, NOT Promise.all: launching all ~120 scripts at
        // once (each a bun process, many spawning their own LSP server) was a
        // 200+-process storm that exhausted pipes/FDs and degraded the whole
        // machine's ability to spawn (observed as multi-minute hangs). The
        // scripts are IO-bound (LSP round-trips), so the pool runs ~2× the
        // cores — bounded, but not starved.
        const POOL = Math.max(8, (await import('os')).cpus().length * 2);
        const t0 = Date.now();
        console.log(`Running ${nonMochaTestFiles.length} bun test suites (pool of ${POOL})...`);
        const queue = [...nonMochaTestFiles];
        const results = [];
        await Promise.all(Array.from({ length: POOL }, async () => {
            while (queue.length > 0) {
                const testFile = queue.shift();
                const command = `bun ${testFile}`;
                try {
                    const { stdout } = await execAsync(command, { encoding: 'utf8', timeout: 30000 });
                    results.push({ testFile, stdout, ok: true });
                } catch (error) {
                    results.push({ testFile, stdout: error.stdout || error.message, ok: false });
                }
            }
        }));
        console.log(`  [standalone pool phase: ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
        return results;
    })();

    const [mochaResult, bunResults] = await Promise.all([mochaPhase, poolPhase]);

    // --- Report mocha results ---
    if (mochaResult) {
        const { passes: mochaPasses, failures: mochaFailures, exitOk: mochaExitOk, failText } = mochaResult;
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
            // Show failure details from the shard outputs
            if (failText) {
                console.log(failText.substring(0, 2000));
            }
        } else {
            // Exit not ok but no failure counts parsed — the invocation itself broke
            console.log('  Mocha invocation failed (no test counts parsed)');
        }
    }

    // --- Report standalone (bun script) results ---
    if (nonMochaTestFiles.length > 0) {
        totalSuites += nonMochaTestFiles.length;

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
