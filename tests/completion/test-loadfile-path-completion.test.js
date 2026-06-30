// `loadfile("…")` / `include("…")` — the first string arg is a FILE PATH, so it gets the
// same relative + multi-directory path completion as `import … from "…"` strings.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfpc-'));
  fs.writeFileSync(path.join(dir, 'handler.uc'), 'global.x=function(){};\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'nested.uc'), 'global.y=1;\n');
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
const labelsAt = async (code, col) => ((await server.getCompletions(code, path.join(dir, 'main.uc'), 0, col)) || []).map(c => c.label);

test('loadfile("./") lists sibling .uc files and subdirs', async () => {
  const code = 'loadfile("./");\n';
  const labels = await labelsAt(code, code.indexOf('./') + 2);
  expect(labels.some(l => /handler\.uc/.test(l))).toBe(true);
  expect(labels.some(l => /sub/.test(l))).toBe(true);
});
test('loadfile("./sub/") descends into the subdirectory (multi-dir)', async () => {
  const code = 'loadfile("./sub/");\n';
  const labels = await labelsAt(code, code.indexOf('sub/') + 4);
  expect(labels.some(l => /nested\.uc/.test(l))).toBe(true);
});
test('include("./") gets the same path completion', async () => {
  const code = 'include("./");\n';
  const labels = await labelsAt(code, code.indexOf('./') + 2);
  expect(labels.some(l => /handler\.uc/.test(l))).toBe(true);
});
test('a non-path string (not a loadfile/include arg) does NOT path-complete', async () => {
  const code = 'let s = "./";\n';
  const labels = await labelsAt(code, code.indexOf('./') + 2);
  expect(labels.some(l => /handler\.uc/.test(l))).toBe(false);
});
