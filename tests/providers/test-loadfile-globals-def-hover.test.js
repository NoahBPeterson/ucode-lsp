// Phase 2 — symbol-side parity for `loadfile("x.uc")()`-injected globals: go-to-definition
// jumps to the `global.X = …` site in the loaded file, and hover shows a coarse type + origin.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf2-'));
  fs.writeFileSync(path.join(dir, 'handler.uc'),
    'global.handle_request = function(env) { return env; };\n' +
    'global.MAX_BODY = 131072;\n' +
    'bare_helper = function() { return 1; };\n');
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
const main = () => path.join(dir, `m-${Math.random().toString(36).slice(2)}.uc`);
const hoverText = (h) => h && (typeof h.contents === 'string' ? h.contents : h.contents.value) || '';

test('go-to-definition lands on the global.X site in the loaded file', async () => {
  const code = 'loadfile("./handler.uc")();\nhandle_request({});\n';
  const def = await server.getDefinition(code, main(), 1, 2);
  const d = Array.isArray(def) ? def[0] : def;
  expect(d).toBeTruthy();
  expect(d.uri).toMatch(/handler\.uc$/);
  expect(d.range.start.line).toBe(0); // `global.handle_request = …` is line 0
});

test('go-to-definition works for a bare implicit global too', async () => {
  const code = 'loadfile("./handler.uc")();\nbare_helper();\n';
  const def = await server.getDefinition(code, main(), 1, 2);
  const d = Array.isArray(def) ? def[0] : def;
  expect(d?.uri).toMatch(/handler\.uc$/);
  expect(d.range.start.line).toBe(2); // bare_helper = … is line 2
});

test('hover on a function global shows function + origin file', async () => {
  const code = 'loadfile("./handler.uc")();\nhandle_request({});\n';
  const v = hoverText(await server.getHover(code, main(), 1, 2));
  expect(v).toMatch(/function/);
  expect(v).toMatch(/handler\.uc/);
});

test('hover on a non-function global shows its coarse type', async () => {
  const code = 'loadfile("./handler.uc")();\nprint(MAX_BODY);\n';
  const col = code.split('\n')[1].indexOf('MAX_BODY') + 1;
  expect(hoverText(await server.getHover(code, main(), 1, col))).toMatch(/integer/);
});
