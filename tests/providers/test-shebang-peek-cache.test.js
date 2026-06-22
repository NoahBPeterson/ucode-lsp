// Unit tests for the mtime-keyed shebang-peek cache (pure functions, no LSP server) —
// so repeated workspace walks don't re-read unchanged extensionless files.
const { test, expect, beforeEach, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isUcodeSourceFile,
  isUcodeSourceFileAsync,
  hasUcodeShebang,
  clearShebangPeekCache,
} = require('../../src/shebang.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shebang-cache-'));
let n = 0;
const tmp = (name) => path.join(dir, `${name}-${n++}`);
// write content + force a specific mtime (ms)
const writeAt = (p, content, mtimeMs) => {
  fs.writeFileSync(p, content);
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
};

beforeEach(() => clearShebangPeekCache());
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

// ── Basic detection ──────────────────────────────────────────────────────────
test('01 *.uc is ucode source (no I/O needed)', () => {
  expect(isUcodeSourceFile('/anywhere/foo.uc')).toBe(true);
});
test('02 extensionless file with a ucode shebang is detected', () => {
  const p = tmp('script'); fs.writeFileSync(p, '#!/usr/bin/env ucode\nprint("hi");\n');
  expect(isUcodeSourceFile(p)).toBe(true);
});
test('03 extensionless file without a ucode shebang is not', () => {
  const p = tmp('sh'); fs.writeFileSync(p, '#!/bin/sh\necho hi\n');
  expect(isUcodeSourceFile(p)).toBe(false);
});
test('04 a file with a non-.uc extension is never peeked', () => {
  const p = tmp('x') + '.c'; fs.writeFileSync(p, '#!/usr/bin/env ucode\n');
  expect(isUcodeSourceFile(p)).toBe(false);
});

// ── mtime caching ─────────────────────────────────────────────────────────────
test('05 verdict is cached by mtime: same mtime → stale cached result is reused', async () => {
  const p = tmp('cached'); const t = 1_700_000_000_000;
  writeAt(p, '#!/usr/bin/env ucode\n', t);
  expect(isUcodeSourceFile(p)).toBe(true); // caches {mtime:t, isUcode:true}
  // Change the CONTENT (no longer a ucode shebang) but restore the SAME mtime.
  writeAt(p, '#!/bin/sh\n', t);
  // A cache hit (mtime unchanged) returns the stale verdict — proving we did NOT re-read.
  expect(isUcodeSourceFile(p)).toBe(true);
});
test('06 a changed mtime invalidates the cache and re-peeks', () => {
  const p = tmp('changed'); const t = 1_700_000_000_000;
  writeAt(p, '#!/usr/bin/env ucode\n', t);
  expect(isUcodeSourceFile(p)).toBe(true);
  writeAt(p, '#!/bin/sh\n', t + 5000); // new mtime → must re-read
  expect(isUcodeSourceFile(p)).toBe(false);
});
test('07 clearShebangPeekCache() forces a fresh peek', () => {
  const p = tmp('clear'); const t = 1_700_000_000_000;
  writeAt(p, '#!/usr/bin/env ucode\n', t);
  expect(isUcodeSourceFile(p)).toBe(true);
  writeAt(p, '#!/bin/sh\n', t); // same mtime → would be a cache hit (stale true)…
  clearShebangPeekCache();        // …but clearing drops the entry
  expect(isUcodeSourceFile(p)).toBe(false); // re-peek sees the real content
});

// ── async variant shares the same cache ──────────────────────────────────────
test('08 async detection matches sync', async () => {
  const p = tmp('async'); fs.writeFileSync(p, '#!/usr/bin/ucode -R\n');
  expect(await isUcodeSourceFileAsync(p)).toBe(true);
});
test('09 async honours the shared mtime cache (stale on same mtime)', async () => {
  const p = tmp('asynccache'); const t = 1_700_000_000_000;
  writeAt(p, '#!/usr/bin/env ucode\n', t);
  expect(await isUcodeSourceFileAsync(p)).toBe(true); // populate cache
  writeAt(p, '#!/bin/sh\n', t);
  expect(isUcodeSourceFile(p)).toBe(true);            // sync sees async's cached entry
  expect(await isUcodeSourceFileAsync(p)).toBe(true); // async hit too
});
test('10 a missing file is not ucode source (no throw)', () => {
  expect(isUcodeSourceFile(path.join(dir, 'does-not-exist'))).toBe(false);
});
