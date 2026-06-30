// References to a `loadfile()()`-injected global span the loadfile boundary: the def is
// `global.X = fn` in handler.uc, the calls are bare `X(...)` in main.uc (which loadfile()s it).
// Import-edge search can't see this (no import binding / no export), so we follow loadfile edges.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, ws, hUri, hText;
beforeAll(async () => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'lfxref-'));
  fs.mkdirSync(path.join(ws, 'lib'));
  hText = 'global.handle_request = function(env){ return env; };\n';
  fs.writeFileSync(path.join(ws, 'lib', 'handler.uc'), hText);
  fs.writeFileSync(path.join(ws, 'main.uc'), 'loadfile("./lib/handler.uc")();\nhandle_request({});\nhandle_request({});\n');
  hUri = path.join(ws, 'lib', 'handler.uc');
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
  server.openOrChangeDocument(`file://${hUri}`, hText);
  server.openOrChangeDocument(`file://${path.join(ws, 'main.uc')}`, fs.readFileSync(path.join(ws, 'main.uc'), 'utf8'));
  await new Promise(r => setTimeout(r, 500));
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

test('CodeLens references count includes the loadfile caller', async () => {
  const lenses = (await server.getCodeLens(hText, hUri)) || [];
  const refLens = lenses.find(l => l.data?.kind === 'refs' && l.data?.name === 'handle_request');
  expect(refLens).toBeTruthy();
  const r = await server.resolveCodeLens(refLens, hUri);
  expect(r?.command?.title).toMatch(/2 reference/);
});
test('go-to-references from the global.X definition finds the caller file', async () => {
  const refs = await server.getReferences(hText, hUri, 0, 'global.handle_request'.indexOf('handle_request'));
  expect((refs || []).some(x => /main\.uc/.test(x.uri))).toBe(true);
  expect((refs || []).filter(x => /main\.uc/.test(x.uri)).length).toBe(2);
});
