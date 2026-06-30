// `loadfile("file.uc")()` runs file.uc's top-level code in the shared global scope — a
// poor-man's import. Globals it injects (top-level `global.X = …` and bare implicit-global
// assignments) must NOT be flagged UC1002/UC1001 in the caller. Verified vs the interpreter:
// those forms leak; function-decls / let / const do NOT. A genuinely-undefined call must
// still flag, and a non-literal (template) path is skipped (unresolvable).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadfile-glob-'));
  fs.writeFileSync(path.join(dir, 'handler.uc'),
    'global.handle_request = function(env) { return env; };\n' +
    'global.MAX_BODY = 131072;\n' +                            // non-function global (read as a value)
    'bare_helper = function() { return 1; };\n' +              // bare implicit global (leaks)
    'function local_only() { return 2; }\n');                  // fn-decl (does NOT leak)
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const u1002 = (ds, name) => ds.filter(d => d.code === 'UC1002' && d.message.includes(name));
async function diagFor(code) {
  const fp = path.join(dir, `main-${Math.random().toString(36).slice(2)}.uc`);
  return (await server.getDiagnostics(code, fp)) || [];
}

test('global.X from the loaded file is callable (no UC1002)', async () => {
  const ds = await diagFor('loadfile("./handler.uc")();\nhandle_request({ x: 1 });\n');
  expect(u1002(ds, 'handle_request').length).toBe(0);
});

test('a non-function injected global READ as a value is not a false UC1001', async () => {
  const ds = await diagFor('loadfile("./handler.uc")();\nprint(MAX_BODY);\n');
  expect(ds.filter(d => d.code === 'UC1001' && d.message.includes('MAX_BODY')).length).toBe(0);
});

test('bare implicit-global from the loaded file is callable too', async () => {
  const ds = await diagFor('loadfile("./handler.uc")();\nbare_helper();\n');
  expect(u1002(ds, 'bare_helper').length).toBe(0);
});

test('a local function-decl in the loaded file does NOT leak (still flagged)', async () => {
  const ds = await diagFor('loadfile("./handler.uc")();\nlocal_only();\n');
  expect(u1002(ds, 'local_only').length).toBe(1);
});

test('a genuinely undefined call is still flagged', async () => {
  const ds = await diagFor('loadfile("./handler.uc")();\nnope_not_real();\n');
  expect(u1002(ds, 'nope_not_real').length).toBe(1);
});

test('a non-literal (template) loadfile path is skipped, but a sibling literal path covers it', async () => {
  // Mirrors the corpus: one template-path loadfile (unresolvable) + one literal-path of the
  // same file (resolvable) — handle_request must still resolve via the literal one.
  const code =
    'let BASE = "/x";\n' +
    'loadfile(`${BASE}/handler.uc`)();\n' +
    'loadfile("./handler.uc")();\n' +
    'handle_request({});\n';
  const ds = await diagFor(code);
  expect(u1002(ds, 'handle_request').length).toBe(0);
});
