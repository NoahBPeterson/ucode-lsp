// `let a = loadfile("x.uc")()` — the call returns the loaded program's top-level
// return value. Verified vs the interpreter: the first explicit top-level `return`
// wins; otherwise the program's value is its LAST top-level statement when that is a
// bare expression statement (REPL-style implicit result); otherwise null. An
// object-literal return carries its member shape (property types) across the file
// boundary. `return M` traces one hop to M's top-level initializer.
// See docs/ucode-module-resolution.md.

import { test, expect, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = '/tmp/test-loadfile-return-inference';
let server;

beforeAll(async () => {
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'objret.uc'),
    'let helper = function(n) { return n * 2; };\nreturn { helper, version: "1.0", count: 42 };\n');
  fs.writeFileSync(path.join(ws, 'intret.uc'), 'return 42;\n');
  fs.writeFileSync(path.join(ws, 'strret.uc'), 'return "hello";\n');
  fs.writeFileSync(path.join(ws, 'nullret.uc'), 'let x = 1;\n');  // last stmt a declaration → null
  fs.writeFileSync(path.join(ws, 'trailing.uc'), 'let x = "trailing value";\nx;\n'); // implicit result
  fs.writeFileSync(path.join(ws, 'named.uc'),
    'let M = { ping: function() { return "pong"; } };\nreturn M;\n'); // return-a-binding pattern
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

const hoverType = async (code, line, character, name) => {
  await server.getDiagnostics(code, path.join(ws, `main-${name}.uc`));
  const hov = await server.getHover(code, path.join(ws, `main-${name}.uc`), line, character);
  const v = hov && hov.contents && (hov.contents.value || hov.contents);
  return typeof v === 'string' ? v : JSON.stringify(v);
};

test('object-literal return → object, with member types', async () => {
  const code = 'let modv = loadfile("objret.uc")();\nlet ver = modv.version;\nlet cnt = modv.count;\n';
  expect(await hoverType(code, 0, 4, 'obj')).toContain('`object`');
  expect(await hoverType(code, 1, 4, 'obj')).toContain('`string`');
  expect(await hoverType(code, 2, 4, 'obj')).toContain('`integer`');
});

test('literal returns → their literal types', async () => {
  expect(await hoverType('let iv = loadfile("intret.uc")();\n', 0, 4, 'int')).toContain('`integer`');
  expect(await hoverType('let sv = loadfile("strret.uc")();\n', 0, 4, 'str')).toContain('`string`');
});

test('no top-level return and no trailing expression → null', async () => {
  expect(await hoverType('let nv = loadfile("nullret.uc")();\n', 0, 4, 'null')).toContain('`null`');
});

test('trailing bare expression is the implicit program result', async () => {
  expect(await hoverType('let tv = loadfile("trailing.uc")();\n', 0, 4, 'trail')).toContain('`string`');
});

test('`return M` traces to the top-level binding (module pattern)', async () => {
  expect(await hoverType('let named = loadfile("named.uc")();\n', 0, 4, 'named')).toContain('`object`');
});

test('unresolvable path stays unknown — no false claims', async () => {
  expect(await hoverType('let gone = loadfile("does-not-exist.uc")();\n', 0, 4, 'gone')).toContain('`unknown`');
});
