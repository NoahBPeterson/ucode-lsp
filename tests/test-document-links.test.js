// Document links: the module-path string in import / re-export / require() is a
// clickable link to the resolved .uc file. Builtin modules (fs, ubus, …) get no
// link (no file to open).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

let dir, server;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uclinks-'));
  fs.writeFileSync(path.join(dir, 'lib.uc'), 'export function helper() { return 1; }\n');
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const mainPath = () => path.join(dir, 'main.uc');
async function links(content) {
  const fp = mainPath();
  fs.writeFileSync(fp, content);
  await server.getDiagnostics(content, fp);
  return (await server.getDocumentLinks(content, fp)) || [];
}

test('import path resolves to a file:// link', async () => {
  const ls = await links(`import { helper } from './lib.uc';\nhelper();\n`);
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
  expect(ls[0].target.startsWith('file://')).toBe(true);
});

test('the link range covers the path, not the surrounding quotes', async () => {
  const content = `import { helper } from './lib.uc';\n`;
  const ls = await links(content);
  expect(ls.length).toBe(1);
  // start char should sit on the '.' of './lib.uc', i.e. just after the quote.
  const lineText = content.split('\n')[0];
  const quoteIdx = lineText.indexOf("'");
  expect(ls[0].range.start.character).toBe(quoteIdx + 1);
  expect(ls[0].range.end.character).toBe(lineText.lastIndexOf("'"));
});

test('require() path also gets a link', async () => {
  const ls = await links(`let h = require('./lib.uc');\n`);
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});

test('builtin module imports get no link', async () => {
  const ls = await links(`import { open } from 'fs';\nopen('/x');\n`);
  expect(ls.length).toBe(0);
});

test('an unresolvable path gets no link', async () => {
  const ls = await links(`import { x } from './does-not-exist.uc';\n`);
  expect(ls.length).toBe(0);
});
