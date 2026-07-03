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

// ── Path shapes beyond './' — previously fell into a document-dir fallback, so typing
// `dir/` re-listed the TOP level (which the client filters down to just the directory:
// no .uc files visible, no descent). The directory part must resolve for ALL shapes.
test('BARE directory + slash descends (no ./ prefix)', async () => {
  const code = 'loadfile("sub/");\n';
  const labels = await labelsAt(code, code.indexOf('sub/') + 4);
  expect(labels.some(l => /nested\.uc/.test(l))).toBe(true);
  expect(labels.some(l => /handler\.uc/.test(l))).toBe(false); // not the top level again
});
test('bare partial filename in a subdirectory filters correctly', async () => {
  const code = 'loadfile("sub/nes");\n';
  const labels = await labelsAt(code, code.indexOf('nes') + 3);
  expect(labels).toEqual(['nested.uc']);
});
test('ABSOLUTE directory path lists that directory', async () => {
  const code = `loadfile("${dir}/sub/");\n`;
  const labels = await labelsAt(code, code.indexOf('/sub/') + 5);
  expect(labels.some(l => /nested\.uc/.test(l))).toBe(true);
});
