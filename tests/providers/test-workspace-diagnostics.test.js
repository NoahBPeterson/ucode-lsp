// Workspace-wide diagnostics: every .uc file is analyzed and its diagnostics
// published on startup (so errors in UNOPENED files surface), deletion clears the
// stale problems, and a closed file's diagnostics refresh when a file it imports
// changes.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const uriOf = (p) => 'file://' + p;
let dir, server, brokenPath, libPath, importerPath;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwsd-'));
  brokenPath = path.join(dir, 'broken.uc');
  fs.writeFileSync(brokenPath, 'let x = ;\n'); // parse error
  libPath = path.join(dir, 'lib.uc');
  fs.writeFileSync(libPath, 'export function helper() { return 1; }\n');
  importerPath = path.join(dir, 'importer.uc');
  // imports a name that lib.uc currently exports — no error yet
  fs.writeFileSync(importerPath, "import { helper } from './lib.uc';\nhelper();\n");
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

test('startup publishes diagnostics for an unopened broken file', async () => {
  const ds = await server.waitForDiagnostics(uriOf(brokenPath), (d) => d && d.length > 0, 6000);
  expect(ds.length).toBeGreaterThan(0);
});

test('deleting a file clears its published problems', async () => {
  // ensure it currently has problems
  await server.waitForDiagnostics(uriOf(brokenPath), (d) => d && d.length > 0, 6000);
  fs.rmSync(brokenPath);
  server.notifyWatchedFileChange(uriOf(brokenPath), 3 /* Deleted */);
  const ds = await server.waitForDiagnostics(uriOf(brokenPath), (d) => d && d.length === 0, 6000);
  expect(ds.length).toBe(0);
});

test('a closed importer refreshes when its dependency changes (export removed)', async () => {
  // importer.uc is unopened; it imports `helper` from lib.uc. Remove that export
  // on disk and notify — the importer should get a fresh diagnostic.
  fs.writeFileSync(libPath, 'export function somethingElse() { return 1; }\n');
  server.notifyWatchedFileChange(uriOf(libPath), 2 /* Changed */);
  const ds = await server.waitForDiagnostics(uriOf(importerPath), (d) => d && d.length > 0, 6000);
  expect(ds.length).toBeGreaterThan(0);
});
