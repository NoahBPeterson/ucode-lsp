#!/usr/bin/env bun
// Sharded full-suite runner: the fast way to run EVERYTHING.
//
// `bun test --concurrent` is NOT safe for this repo — it interleaves tests
// within a file, and the e2e suites are stateful (tests in a suite reuse the
// same document URI on one LSP server, and quick-fix flows span multiple
// helper calls), so concurrency corrupts them (~97 deterministic failures).
//
// Instead: shard the *.test.js files round-robin across a few `bun test`
// PROCESSES. Each process runs its files sequentially — byte-for-byte the
// supported semantics, with its own shared LSP server — and the shards run
// side by side. Coverage and correctness are identical to `bun test tests/`;
// only the wall-clock changes.
import { readdirSync } from 'fs';
import { join } from 'path';
import { cpus } from 'os';
import { spawn } from 'child_process';

const SHARDS = Number(process.env.TEST_FAST_SHARDS) || Math.min(5, Math.max(2, Math.floor(cpus().length / 2)));

// Same discovery as `bun test tests/`: every *.test.js under tests/.
function discover(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...discover(p));
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}
const files = discover('tests').sort();

const shards = Array.from({ length: SHARDS }, () => []);
files.forEach((f, i) => shards[i % SHARDS].push(f));

console.log(`Running ${files.length} test files in ${SHARDS} sharded bun processes...\n`);
const t0 = Date.now();

const results = await Promise.all(shards.map((shardFiles, i) => new Promise((resolve) => {
  const proc = spawn('bun', ['test', ...shardFiles], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  proc.on('close', (code) => {
    // Bun's run summary is the LAST "N pass"/"N fail" pair in the output
    // (earlier ones can come from nested runners' echoed output).
    const passes = [...out.matchAll(/^\s*(\d+) pass\s*$/gm)];
    const fails = [...out.matchAll(/^\s*(\d+) fail\s*$/gm)];
    const pass = Number(passes.at(-1)?.[1] ?? 0);
    const fail = Number(fails.at(-1)?.[1] ?? 0);
    console.log(`  shard ${i + 1}: ${pass} pass, ${fail} fail (${shardFiles.length} files, exit ${code})`);
    resolve({ code, pass, fail, out });
  });
})));

const pass = results.reduce((n, r) => n + r.pass, 0);
const fail = results.reduce((n, r) => n + r.fail, 0);
const bad = results.filter((r) => r.code !== 0 || r.fail > 0);

console.log(`\n${pass} pass, ${fail} fail across ${files.length} files [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
for (const r of bad) {
  // Surface each failing shard's output (failure details live there).
  console.log('\n--- failing shard output ---');
  console.log(r.out.split('\n').filter((l) => l.includes('fail') || l.includes('✗') || l.includes('error')).slice(0, 60).join('\n'));
}
process.exit(bad.length > 0 ? 1 : 0);
