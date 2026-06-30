// Go-to-definition on a path STRING opens the referenced file — for `import … from "x.uc"`,
// `loadfile("x.uc")`, and `include("x.uc")`. A plain (non-path) string is not a target.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathdef-'));
  fs.writeFileSync(path.join(dir, 'handler.uc'), 'export let x = 1;\nglobal.y = function(){};\n');
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
const defAt = (code, col) => server.getDefinition(code, path.join(dir, 'm.uc'), 0, col);

test('loadfile("./handler.uc") path → opens handler.uc', async () => {
  const c = 'loadfile("./handler.uc")();\n';
  expect(JSON.stringify(await defAt(c, c.indexOf('handler')))).toMatch(/handler\.uc/);
});
test('include("./handler.uc") path → opens handler.uc', async () => {
  const c = 'include("./handler.uc");\n';
  expect(JSON.stringify(await defAt(c, c.indexOf('handler')))).toMatch(/handler\.uc/);
});
test('import … from "./handler.uc" path → opens handler.uc', async () => {
  const c = 'import { x } from "./handler.uc";\n';
  expect(JSON.stringify(await defAt(c, c.indexOf('handler')))).toMatch(/handler\.uc/);
});
test('a plain string literal is not a go-to-definition target', async () => {
  const c = 'let s = "./handler.uc";\n';
  expect(await defAt(c, c.indexOf('handler'))).toBeNull();
});
