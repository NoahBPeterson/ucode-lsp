#!/usr/bin/env node
/**
 * End-to-end coverage for the ucode LSP server.
 *
 * Most of this project's tests drive the real server over stdio (the helper
 * spawns `node dist/server.js`), and that bundle contains all of src/. So the
 * accurate "what do our tests actually exercise?" signal is V8 coverage of the
 * spawned server process, remapped through the source map back to src/.
 *
 * Pipeline:
 *   1. Build the server bundle WITH full source maps (`--devtool source-map`),
 *      so the bundle's coverage can be remapped to the original TypeScript.
 *   2. Run the whole suite under NODE_V8_COVERAGE, with cov-preload.cjs injected
 *      via NODE_OPTIONS so the SIGTERM-killed server flushes its coverage.
 *      Every spawned `node` server (from mocha- and bun-run suites) writes a
 *      coverage file; the bun/mocha runner processes write their own (ignored).
 *   3. Feed the raw V8 coverage to monocart, keeping only the server bundle
 *      entry (which remaps to src/*.ts) and reporting on src/ only.
 *
 * Output: ./coverage/index.html (+ a console summary and the lowest-covered
 * files, which are the end-to-end gaps).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW = path.join(ROOT, '.coverage-raw');
const OUT = path.join(ROOT, 'coverage');
const PRELOAD = path.join(__dirname, 'cov-preload.cjs');
const SUITE = './tests/test-all-validations.test.js';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...(opts.env || {}) } });
  if (r.error) throw r.error;
  return r.status ?? 0;
}

(async () => {
  // 1. Build with full source maps (overrides webpack.config.js devtool).
  console.log('\n[coverage] building server bundle with source maps...');
  if (run('./node_modules/.bin/webpack', ['--devtool', 'source-map']) !== 0) {
    console.error('[coverage] build failed');
    process.exit(1);
  }

  // 2. Run the full suite under V8 coverage. Don't fail-fast on test failures —
  //    coverage of a partially-failing run is still useful.
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.mkdirSync(RAW, { recursive: true });
  console.log('\n[coverage] running suite under NODE_V8_COVERAGE...');
  const testStatus = run('bun', ['test', SUITE], {
    env: { NODE_V8_COVERAGE: RAW, NODE_OPTIONS: `--require ${PRELOAD}` },
  });
  if (testStatus !== 0) console.warn(`\n[coverage] note: suite exited ${testStatus} (continuing with collected coverage)`);

  // 3. Remap the server bundle's coverage back to src/ and report.
  console.log('\n[coverage] generating report...');
  const MCR = require('monocart-coverage-reports');
  const mcr = MCR({
    name: 'ucode-lsp LSP server — end-to-end coverage',
    outputDir: OUT,
    reports: ['v8', 'console-summary'],
    // Keep only the server bundle entry (drops the test-runner processes and
    // their node_modules); it remaps to all of src/* via the source map.
    entryFilter: (e) => !!e.url && e.url.includes('dist/server.js'),
    // Within the bundle, keep our TypeScript sources (drop bundled node_modules).
    sourceFilter: (p) => p.includes('/src/') || p.startsWith('src/'),
  });

  await mcr.addFromDir(RAW);
  const res = await mcr.generate();

  // Print the lowest-covered src files — the actual end-to-end gaps.
  const rows = (res.files || [])
    .map((f) => ({
      file: String(f.sourcePath || f.source || '').replace(/^.*\/src\//, 'src/'),
      lines: f.summary?.lines?.pct ?? 0,
      funcs: f.summary?.functions?.pct ?? 0,
    }))
    .filter((r) => r.file.startsWith('src/'))
    .sort((a, b) => a.lines - b.lines);

  console.log('\n[coverage] lowest-covered src files (end-to-end gaps):');
  console.log('  ' + 'file'.padEnd(48) + 'lines%  funcs%');
  for (const r of rows.slice(0, 15)) {
    console.log('  ' + r.file.padEnd(48) + String(r.lines).padStart(6) + String(r.funcs).padStart(8));
  }
  console.log(`\n[coverage] HTML report: ${path.join(OUT, 'index.html')}`);
})().catch((e) => {
  console.error('[coverage] failed:', e);
  process.exit(1);
});
