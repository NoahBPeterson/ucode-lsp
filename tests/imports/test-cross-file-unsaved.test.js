// Cross-file ops must use an importer's LIVE (unsaved) buffer, not stale disk.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = '/tmp/test-xfile-unsaved';
const libPath = path.join(ws, 'lib.uc');
const mainPath = path.join(ws, 'main.uc');

let server;
beforeAll(async () => {
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(libPath, `export function foo() { return 1; }\n`);
  // On DISK, main uses foo once.
  fs.writeFileSync(mainPath, `import { foo } from './lib.uc';\nlet a = foo();\n`);
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

test('rename from another file sees an open importer\'s unsaved extra usage', async () => {
  // Open main.uc with an UNSAVED second usage (differs from disk).
  const unsavedMain = `import { foo } from './lib.uc';\nlet a = foo();\nlet b = foo();\n`;
  await server.getDiagnostics(unsavedMain, mainPath); // didOpen with unsaved content

  // Rename foo from lib.uc; the edit set must reflect the live buffer (2 usages).
  const libContent = fs.readFileSync(libPath, 'utf8');
  const we = await server.getRename(libContent, libPath, 0, libContent.indexOf('foo'), 'baz');
  const mainEdits = (we && we.changes && we.changes[`file://${mainPath}`]) || [];
  // import specifier + TWO usages = 3 (would be 2 if it read stale disk).
  expect(mainEdits.length).toBe(3);
});
