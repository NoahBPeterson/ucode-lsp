// Hardcore edge-case matrix for workspace-wide diagnostics: startup publishing for
// unopened files, directory exclusions, the create/change/fix/delete lifecycle, and
// cross-file (open + closed + transitive) invalidation.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// These tests wait on real async (re)analysis + cross-file invalidation, which can
// exceed bun's 5s default per-test timeout under a busy sequence. Raise it well
// above every internal waitForDiagnostics timeout below.
setDefaultTimeout(20000);

const CREATED = 1, CHANGED = 2, DELETED = 3;
let dir, server;
const uriOf = (p) => 'file://' + p;
const P = (rel) => path.join(dir, rel);
const writeFile = (rel, body) => { const p = P(rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return p; };

// Startup fixture — present BEFORE the server initializes, so the startup scan sees them.
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucwsde-'));
  writeFile('parse_err.uc', 'let a = ;\n');                         // parse error
  writeFile('semantic_err.uc', "fs.readfile('/x');\n");            // UC3006: module used without import
  writeFile('clean.uc', 'let ok = 1;\nprint(ok);\n'); // genuinely no errors (no unused symbol)
  writeFile('nested/deep_err.uc', 'let b = ;\n');                  // error in a subdir
  writeFile('multi_a.uc', 'let c = ;\n');
  writeFile('multi_b.uc', 'let d = ;\n');
  writeFile('node_modules/excluded.uc', 'let e = ;\n');           // must be excluded
  writeFile('.hidden/hiddenerr.uc', 'let g = ;\n');               // dot-dir, excluded
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const waitErr = (uri, ms = 10000) => server.waitForDiagnostics(uri, (d) => d && d.length > 0, ms);
const waitClean = (uri, ms = 10000) => server.waitForDiagnostics(uri, (d) => d && d.length === 0, ms);
async function neverPublishes(uri, ms = 2500) {
  try { await server.waitForDiagnostics(uri, (d) => d && d.length > 0, ms); return false; }
  catch { return true; }
}

// ── Startup publishing for unopened files ────────────────────────────────────
test('01 startup publishes a parse error for an unopened file', async () => {
  expect((await waitErr(uriOf(P('parse_err.uc')))).length).toBeGreaterThan(0);
});
test('02 startup publishes a semantic error (UC3006) for an unopened file', async () => {
  const ds = await waitErr(uriOf(P('semantic_err.uc')));
  expect(ds.some(d => d.code === 'UC3006')).toBe(true);
});
test('03 startup publishes an empty list for a clean unopened file', async () => {
  expect((await waitClean(uriOf(P('clean.uc')))).length).toBe(0);
});
test('04 startup publishes for an error file in a subdirectory', async () => {
  expect((await waitErr(uriOf(P('nested/deep_err.uc')))).length).toBeGreaterThan(0);
});
test('05 startup publishes for multiple error files', async () => {
  expect((await waitErr(uriOf(P('multi_a.uc')))).length).toBeGreaterThan(0);
  expect((await waitErr(uriOf(P('multi_b.uc')))).length).toBeGreaterThan(0);
});

// ── Directory exclusions ─────────────────────────────────────────────────────
test('06 a node_modules file is never analyzed/published', async () => {
  expect(await neverPublishes(uriOf(P('node_modules/excluded.uc')))).toBe(true);
});
test('07 a dot-directory file is never analyzed/published', async () => {
  expect(await neverPublishes(uriOf(P('.hidden/hiddenerr.uc')))).toBe(true);
});

// ── Create / change / fix / delete lifecycle ─────────────────────────────────
test('08 creating a new error file publishes its diagnostics', async () => {
  const p = writeFile('created_err.uc', 'let h = ;\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  expect((await waitErr(uriOf(p))).length).toBeGreaterThan(0);
});
test('09 creating a clean file publishes an empty list', async () => {
  const p = writeFile('created_clean.uc', 'print(1);\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  expect((await waitClean(uriOf(p))).length).toBe(0);
});
test('10 changing a clean file to introduce an error publishes it', async () => {
  const p = writeFile('mutate.uc', 'print(1);\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  await waitClean(uriOf(p));
  fs.writeFileSync(p, 'let q = ;\n');
  server.notifyWatchedFileChange(uriOf(p), CHANGED);
  expect((await waitErr(uriOf(p))).length).toBeGreaterThan(0);
});
test('11 changing an error file to fix it clears the diagnostics', async () => {
  const p = writeFile('fixme.uc', 'let w = ;\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  await waitErr(uriOf(p));
  fs.writeFileSync(p, 'print(1);\n');
  server.notifyWatchedFileChange(uriOf(p), CHANGED);
  expect((await waitClean(uriOf(p))).length).toBe(0);
});
test('12 deleting an error file clears its published problems', async () => {
  const p = writeFile('deleteme.uc', 'let v = ;\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  await waitErr(uriOf(p));
  fs.rmSync(p);
  server.notifyWatchedFileChange(uriOf(p), DELETED);
  expect((await waitClean(uriOf(p))).length).toBe(0);
});
test('13 deleting a file with MULTIPLE diagnostics clears all of them', async () => {
  const p = writeFile('multidiag.uc', 'fs.readfile("/x");\nubus.connect();\n'); // two UC3006s
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  const before = await waitErr(uriOf(p));
  expect(before.length).toBeGreaterThanOrEqual(2);
  fs.rmSync(p);
  server.notifyWatchedFileChange(uriOf(p), DELETED);
  expect((await waitClean(uriOf(p))).length).toBe(0);
});

// ── Cross-file invalidation ──────────────────────────────────────────────────
test('14 a CLOSED importer gets an error when its dependency drops the export', async () => {
  const lib = writeFile('dep_lib.uc', 'export function depFn() { return 1; };\n');
  const imp = writeFile('dep_importer.uc', "import { depFn } from './dep_lib.uc';\ndepFn();\n");
  server.notifyWatchedFileChange(uriOf(lib), CREATED);
  server.notifyWatchedFileChange(uriOf(imp), CREATED);
  await waitClean(uriOf(imp)); // importer is fine to start
  fs.writeFileSync(lib, 'export function other() { return 1; };\n'); // depFn gone
  server.notifyWatchedFileChange(uriOf(lib), CHANGED);
  expect((await waitErr(uriOf(imp))).length).toBeGreaterThan(0);
});
test('15 a CLOSED importer clears its error when the dependency restores the export', async () => {
  const lib = writeFile('dep_lib2.uc', 'export function other() { return 1; };\n'); // missing depFn2
  const imp = writeFile('dep_importer2.uc', "import { depFn2 } from './dep_lib2.uc';\ndepFn2();\n");
  server.notifyWatchedFileChange(uriOf(lib), CREATED);
  server.notifyWatchedFileChange(uriOf(imp), CREATED);
  await waitErr(uriOf(imp)); // missing export -> error
  fs.writeFileSync(lib, 'export function depFn2() { return 1; };\n'); // restore
  server.notifyWatchedFileChange(uriOf(lib), CHANGED);
  expect((await waitClean(uriOf(imp))).length).toBe(0);
});
test('16 deleting a dependency surfaces an error in its closed importer', async () => {
  const lib = writeFile('gone_lib.uc', 'export function goneFn() { return 1; };\n');
  const imp = writeFile('gone_importer.uc', "import { goneFn } from './gone_lib.uc';\ngoneFn();\n");
  server.notifyWatchedFileChange(uriOf(lib), CREATED);
  server.notifyWatchedFileChange(uriOf(imp), CREATED);
  await waitClean(uriOf(imp));
  fs.rmSync(lib);
  server.notifyWatchedFileChange(uriOf(lib), DELETED);
  // the deleted lib's own problems are cleared...
  expect((await waitClean(uriOf(lib))).length).toBe(0);
  // ...and the importer now reports the broken import
  expect((await waitErr(uriOf(imp))).length).toBeGreaterThan(0);
});
test('17 transitive: changing C invalidates a closed A that imports B that imports C', async () => {
  const c = writeFile('chain_c.uc', 'export function cFn() { return 1; };\n');
  const b = writeFile('chain_b.uc', "import { cFn } from './chain_c.uc';\nexport function bFn() { return cFn(); };\n");
  const a = writeFile('chain_a.uc', "import { bFn } from './chain_b.uc';\nbFn();\n");
  for (const f of [c, b, a]) server.notifyWatchedFileChange(uriOf(f), CREATED);
  await waitClean(uriOf(b));
  fs.writeFileSync(c, 'export function notCFn() { return 1; };\n'); // cFn gone -> B's import breaks
  server.notifyWatchedFileChange(uriOf(c), CHANGED);
  expect((await waitErr(uriOf(b))).length).toBeGreaterThan(0);
});
test('18 an OPEN importer is re-analyzed when its dependency changes', async () => {
  const lib = writeFile('open_lib.uc', 'export function openFn() { return 1; };\n');
  const imp = writeFile('open_importer.uc', "import { openFn } from './open_lib.uc';\nopenFn();\n");
  server.notifyWatchedFileChange(uriOf(lib), CREATED);
  // open the importer (so it's a live document, not just on disk)
  await server.getDiagnostics("import { openFn } from './open_lib.uc';\nopenFn();\n", imp);
  fs.writeFileSync(lib, 'export function renamed() { return 1; };\n');
  server.notifyWatchedFileChange(uriOf(lib), CHANGED);
  expect((await waitErr(uriOf(imp))).length).toBeGreaterThan(0);
});

// ── Robustness ───────────────────────────────────────────────────────────────
test('19 a non-.uc watched change is ignored (no diagnostics)', async () => {
  const p = writeFile('notes.txt', 'let broken = ;\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  expect(await neverPublishes(uriOf(p))).toBe(true);
});
test('20 re-analyzing the same content is idempotent (stable diagnostic count)', async () => {
  const p = writeFile('idem.uc', 'fs.readfile("/x");\n');
  server.notifyWatchedFileChange(uriOf(p), CREATED);
  const first = (await waitErr(uriOf(p))).length;
  server.notifyWatchedFileChange(uriOf(p), CHANGED); // same content on disk
  const again = await server.waitForDiagnostics(uriOf(p), (d) => d && d.length === first, 6000);
  expect(again.length).toBe(first);
});
