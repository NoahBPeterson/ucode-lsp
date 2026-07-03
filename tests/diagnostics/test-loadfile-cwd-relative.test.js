// UC8009 — loadfile() with a RELATIVE literal path resolves against the ucode
// process's working directory (wherever ucode was launched — lib.c uc_loadfile →
// fopen; interpreter-verified), NOT this file's directory. Works in dev, breaks under
// procd/init where CWD is '/'. Quick fixes: (preferred) file-relative via
// sourcepath(0, true) + "/…", and the deployed absolute path when the target sits in
// an OpenWrt package files/ tree. See docs/ucode-module-resolution.md §5.

import { test, expect, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Mirror an OpenWrt package tree so the deployed-path fix has something real to find.
const ws = '/tmp/test-loadfile-cwd-rel';
const pkgdir = path.join(ws, 'files', 'lib', 'netifd');
let server;

beforeAll(async () => {
  fs.mkdirSync(pkgdir, { recursive: true });
  fs.writeFileSync(path.join(pkgdir, 'wireless.uc'), 'return {};\n');
  fs.writeFileSync(path.join(pkgdir, 'main.uc'), 'print(1);\n');
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

const uc8009 = (d) => d.filter(x => x.code === 'UC8009');
const diagsIn = (code, rel) => server.getDiagnostics(code, path.join(ws, rel));

test('relative literal path warns', async () => {
  const d = await diagsIn('let m = loadfile("wireless.uc")();\nm;\n', 'files/lib/netifd/main.uc');
  expect(uc8009(d).length).toBe(1);
  expect(uc8009(d)[0].severity).toBe(2); // Warning
  expect(uc8009(d)[0].message).toContain('sourcepath(0, true)');
});

test('./-relative literal path warns too', async () => {
  const d = await diagsIn('loadfile("./wireless.uc");\n', 'files/lib/netifd/main.uc');
  expect(uc8009(d).length).toBe(1);
});

test('absolute path does not warn', async () => {
  const d = await diagsIn('loadfile("/lib/netifd/wireless.uc");\n', 'files/lib/netifd/main.uc');
  expect(uc8009(d)).toEqual([]);
});

test('variable argument does not warn (only literals are claimable)', async () => {
  const d = await diagsIn('function f(p) { return loadfile(p); }\nf("x");\n', 'files/lib/netifd/main.uc');
  expect(uc8009(d)).toEqual([]);
});

test('sourcepath-based expression does not warn', async () => {
  const d = await diagsIn('loadfile(sourcepath(0, true) + "/wireless.uc");\n', 'files/lib/netifd/main.uc');
  expect(uc8009(d)).toEqual([]);
});

test('quick fixes: sourcepath rewrite (preferred) + deployed absolute path', async () => {
  const file = 'files/lib/netifd/main-fix.uc';
  const code = 'let m = loadfile("wireless.uc")();\nm;\n';
  const d = await diagsIn(code, file);
  const diag = uc8009(d)[0];
  expect(diag).toBeTruthy();
  const actions = await server.getCodeActions(path.join(ws, file), [diag], 0, 20);
  const titles = actions.map(a => a.title);
  const srcFix = actions.find(a => a.title === 'Make file-relative: sourcepath(0, true) + "/wireless.uc"');
  expect(srcFix).toBeTruthy();
  expect(srcFix.isPreferred).toBe(true);
  const depFix = actions.find(a => a.title === 'Use deployed absolute path "/lib/netifd/wireless.uc"');
  expect(depFix, `got: ${titles.join(' | ')}`).toBeTruthy();
  // Edits replace exactly the string literal (AST offsets).
  const edit = srcFix.edit.changes[`file://${path.join(ws, file)}`][0];
  expect(edit.newText).toBe('sourcepath(0, true) + "/wireless.uc"');
  expect(edit.range.start.character).toBe(code.indexOf('"wireless.uc"'));
});
