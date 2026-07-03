// UC3008 — require() with a path-shaped argument can NEVER resolve: the search-path
// template splice accepts only [A-Za-z0-9_.] in module names (lib.c uc_require_path),
// so '/' never matches and the call throws unconditionally. Hard error (try/catch or
// not — the guarded call is equally dead), replacing the old UC8001 "guard it with
// try/catch" framing which was wrong advice for this case.
// See docs/ucode-module-resolution.md §4.

import { test, expect } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
const diags = async (code, name) => {
  if (!server) { server = createLSPTestServer(); await server.initialize(); }
  return server.getDiagnostics(code, `/tmp/uc3008-${name}.uc`);
};
const uc3008 = (d) => d.filter(x => x.code === 'UC3008');
const uc8001 = (d) => d.filter(x => x.code === 'UC8001');

test('require("./relative.uc") is a hard error, not an unguarded-call warning', async () => {
  const d = await diags('require("./relative.uc");\n', 'rel');
  expect(uc3008(d).length).toBe(1);
  expect(uc3008(d)[0].severity).toBe(1); // Error
  expect(uc3008(d)[0].message).toContain('loadfile');
  expect(uc8001(d)).toEqual([]); // no redundant "guard it" advice
});

test('require("/abs/path.uc") is a hard error too', async () => {
  const d = await diags('require("/abs/path.uc");\n', 'abs');
  expect(uc3008(d).length).toBe(1);
});

test('try/catch does NOT silence it — the call can never succeed', async () => {
  const d = await diags('try { require("./x.uc"); } catch (e) { }\n', 'guarded');
  expect(uc3008(d).length).toBe(1);
});

test('dotted names keep the UC8001 unguarded-call treatment', async () => {
  const d = await diags('require("maybe.missing");\n', 'dotted');
  expect(uc3008(d)).toEqual([]);
  expect(uc8001(d).length).toBe(1);
});

test('builtin module names stay clean', async () => {
  const d = await diags('let fsm = require("fs");\nfsm.readfile("/etc/hosts");\n', 'builtin');
  expect(uc3008(d)).toEqual([]);
});
