// Bare `import "module";` (no bindings) is a SIDE-EFFECT import — ucode supports it
// (its compiler falls through to the module string with an empty import list and runs the
// module's top-level), so the LSP must NOT flag it UC6001 "Expected identifier". A truly
// malformed `import <non-string>;` still errors; bound imports are unaffected.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bareimp-'));
  fs.writeFileSync(path.join(dir, 'sidemod.uc'), 'export let marker = 1;\nprint("side\\n");\n');
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
const codes = async (code) => ((await server.getDiagnostics(code, path.join(dir, `m-${Math.random().toString(36).slice(2)}.uc`))) || []).map(d => d.code);

test('bare `import "./sidemod.uc";` is accepted (no UC6001)', async () => {
  const c = await codes('import "./sidemod.uc";\nprint("ok\\n");\n');
  expect(c).not.toContain('UC6001');
});
test('bound `import { marker } from "./sidemod.uc";` still works (no UC6001)', async () => {
  const c = await codes('import { marker } from "./sidemod.uc";\nprint(marker);\n');
  expect(c).not.toContain('UC6001');
});
test('malformed `import 123;` still errors (UC6001)', async () => {
  const c = await codes('import 123;\n');
  expect(c).toContain('UC6001');
});
