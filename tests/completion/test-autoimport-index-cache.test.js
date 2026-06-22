// The auto-import candidate set comes from a cached workspace export index (built
// once, reused per keystroke). It must invalidate on file save/create/delete so a
// newly-added export appears with NO stale window — and a deleted one disappears.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const CREATED = 1, CHANGED = 2, DELETED = 3;
let dir, server;
const uriOf = (p) => 'file://' + p;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucaiidx-'));
  fs.writeFileSync(path.join(dir, 'seed.uc'), 'export function seedFn() { return 1; }\n');
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const items = (c) => (Array.isArray(c) ? c : (c && c.items) || []);
async function autoImportLabels(prefix) {
  const fp = path.join(dir, 'main.uc');
  const c = `let x = ${prefix}\n`;
  fs.writeFileSync(fp, c);
  await server.getDiagnostics(c, fp);
  const r = items(await server.getCompletions(c, fp, 0, `let x = ${prefix}`.length));
  return r.filter((i) => i.additionalTextEdits).map((i) => i.label);
}

test('the seed export is offered (index built)', async () => {
  expect(await autoImportLabels('seed')).toContain('seedFn');
});

test('a newly CREATED file\'s export appears immediately (no stale window)', async () => {
  // Prime the index first (cache it), then add a new file.
  await autoImportLabels('seed');
  const p = path.join(dir, 'fresh.uc');
  fs.writeFileSync(p, 'export function freshFn() { return 1; }\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  expect(await autoImportLabels('fresh')).toContain('freshFn');
});

test('an export ADDED to an existing file appears after its change', async () => {
  const p = path.join(dir, 'grow.uc');
  fs.writeFileSync(p, 'export function one() { return 1; }\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  await autoImportLabels('one'); // cache includes grow.uc with just `one`
  fs.writeFileSync(p, 'export function one() { return 1; }\nexport function two() { return 2; }\n');
  server.notifyWatchedFileChange(uriOf(p), CHANGED);
  expect(await autoImportLabels('two')).toContain('two');
});

test('a DELETED file\'s export is no longer offered', async () => {
  const p = path.join(dir, 'doomed.uc');
  fs.writeFileSync(p, 'export function doomedFn() { return 1; }\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  expect(await autoImportLabels('doomed')).toContain('doomedFn');
  fs.rmSync(p);
  server.notifyWatchedFileChange(uriOf(p), DELETED);
  expect(await autoImportLabels('doomed')).not.toContain('doomedFn');
});

test('a name exported by two files still yields two pickable sources via the index', async () => {
  fs.writeFileSync(path.join(dir, 'dupA.uc'), 'export function shared() { return 1; }\n');
  fs.writeFileSync(path.join(dir, 'dupB.uc'), 'export function shared() { return 2; }\n');
  server.notifyWatchedFileChange(uriOf(path.join(dir, 'dupA.uc')), CREATED);
  server.notifyWatchedFileChange(uriOf(path.join(dir, 'dupB.uc')), CREATED);
  const fp = path.join(dir, 'main.uc');
  const c = 'let x = shared\n';
  fs.writeFileSync(fp, c);
  await server.getDiagnostics(c, fp);
  const r = items(await server.getCompletions(c, fp, 0, 'let x = shared'.length));
  const sources = r.filter((i) => i.label === 'shared' && i.additionalTextEdits).map((i) => i.detail).sort();
  expect(sources.length).toBe(2);
  expect(sources[0]).toContain('dupA.uc');
  expect(sources[1]).toContain('dupB.uc');
});
