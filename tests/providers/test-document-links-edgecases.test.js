// Hardcore edge-case matrix for document links (module-path → clickable file).
// Covers each link source (import/re-export/export-*/require), non-links (builtins,
// unresolvable, strings, comments, non-string require), range precision, path forms,
// and structural placement.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

let dir, server;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucdle-'));
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib.uc'), 'export function helper() { return 1; }\n');
  fs.writeFileSync(path.join(dir, 'sub', 'deep.uc'), 'export function deepFn() { return 1; }\n');
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

async function links(content, rel = 'main.uc') {
  const fp = path.join(dir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
  await server.getDiagnostics(content, fp);
  return (await server.getDocumentLinks(content, fp)) || [];
}
const targets = (ls) => ls.map(l => l.target);

// ── Link sources ─────────────────────────────────────────────────────────────
test('01 a plain import gets one link to the file', async () => {
  const ls = await links("import { helper } from './lib.uc';\n");
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});
test('02 a re-export (export { x } from) gets a link', async () => {
  const ls = await links("export { helper } from './lib.uc';\n");
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});
test('03 an export-all (export * from) gets a link', async () => {
  const ls = await links("export * from './lib.uc';\n");
  expect(ls.length).toBe(1);
});
test('04 require() gets a link', async () => {
  const ls = await links("let m = require('./lib.uc');\n");
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});
test('05 a namespace import gets a link', async () => {
  const ls = await links("import * as lib from './lib.uc';\n");
  expect(ls.length).toBe(1);
});
test('06 a default import gets a link', async () => {
  const ls = await links("import lib from './lib.uc';\n");
  expect(ls.length).toBe(1);
});
test('07 a mixed default + named import gets a single link', async () => {
  const ls = await links("import def, { helper } from './lib.uc';\n");
  expect(ls.length).toBe(1);
});

// ── Non-links ────────────────────────────────────────────────────────────────
test('08 a builtin module import gets no link', async () => {
  expect((await links("import { open } from 'fs';\n")).length).toBe(0);
});
test('09 an unresolvable path gets no link', async () => {
  expect((await links("import { x } from './nope.uc';\n")).length).toBe(0);
});
test('10 an empty path gets no link', async () => {
  expect((await links("import { x } from '';\n")).length).toBe(0);
});
test('11 require with a non-string (variable) argument gets no link', async () => {
  expect((await links("let p = './lib.uc';\nlet m = require(p);\n")).length).toBe(0);
});
test('12 a method call `o.require(...)` is not treated as the require builtin', async () => {
  expect((await links("let o = {};\nlet m = o.require('./lib.uc');\n")).length).toBe(0);
});
test('13 an import-like string literal is not a link', async () => {
  expect((await links("let s = \"import { x } from './lib.uc'\";\n")).length).toBe(0);
});
test('14 an import-like comment is not a link', async () => {
  expect((await links("// import { x } from './lib.uc'\nlet y = 1;\n")).length).toBe(0);
});
test('15 a normal `export { x }` (no source) is not a link', async () => {
  expect((await links("function x() {}\nexport { x };\n")).length).toBe(0);
});

// ── Range precision ──────────────────────────────────────────────────────────
test('16 the range excludes single quotes', async () => {
  const content = "import { helper } from './lib.uc';\n";
  const ls = await links(content);
  const line = content.split('\n')[0];
  expect(ls[0].range.start.character).toBe(line.indexOf("'") + 1);
  expect(ls[0].range.end.character).toBe(line.lastIndexOf("'"));
});
test('17 the range excludes double quotes', async () => {
  const content = 'import { helper } from "./lib.uc";\n';
  const ls = await links(content);
  const line = content.split('\n')[0];
  expect(ls[0].range.start.character).toBe(line.indexOf('"') + 1);
  expect(ls[0].range.end.character).toBe(line.lastIndexOf('"'));
});
test('18 the range starts on the "." of the path', async () => {
  const content = "import { helper } from './lib.uc';\n";
  const ls = await links(content);
  expect(content.charAt(ls[0].range.start.character)).toBe('.');
});
test('19 extra whitespace before the path keeps the range on the path', async () => {
  const content = "import { helper } from     './lib.uc';\n";
  const ls = await links(content);
  expect(content.charAt(ls[0].range.start.character)).toBe('.');
  expect(content.slice(ls[0].range.start.character, ls[0].range.end.character)).toBe('./lib.uc');
});

// ── Path forms ───────────────────────────────────────────────────────────────
test('20 a subdirectory path links', async () => {
  const ls = await links("import { deepFn } from './sub/deep.uc';\n");
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/sub\/deep\.uc$/);
});
test('21 a parent-directory path links (importer in subdir)', async () => {
  const ls = await links("import { helper } from '../lib.uc';\n", 'sub/importer.uc');
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});
test('22 a relative path WITHOUT the .uc extension does not resolve (so no link)', async () => {
  // ucode requires the explicit `.uc` for relative imports (finding #70), so an
  // extensionless path is unresolvable — no clickable link is produced.
  const ls = await links("import { helper } from './lib';\n");
  expect(ls.length).toBe(0);
});
test('23 the link target is an absolute file:// URI', async () => {
  const ls = await links("import { helper } from './lib.uc';\n");
  expect(ls[0].target.startsWith('file://')).toBe(true);
});

// ── Multiplicity / structure ─────────────────────────────────────────────────
test('24 multiple distinct imports yield multiple links', async () => {
  const ls = await links("import { helper } from './lib.uc';\nimport { deepFn } from './sub/deep.uc';\n");
  expect(ls.length).toBe(2);
});
test('25 two imports of the same file yield two links', async () => {
  const ls = await links("import { helper } from './lib.uc';\nimport * as l2 from './lib.uc';\n");
  expect(ls.length).toBe(2);
});
test('26 a mix of builtin and local imports links only the local one', async () => {
  const ls = await links("import { open } from 'fs';\nimport { helper } from './lib.uc';\n");
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});
test('27 require with extra arguments still links the first (path) arg', async () => {
  const ls = await links("let m = require('./lib.uc', 1);\n");
  expect(ls.length).toBe(1);
  expect(ls[0].target).toMatch(/lib\.uc$/);
});
test('28 a require nested in an expression links', async () => {
  const ls = await links("let arr = [ require('./lib.uc') ];\n");
  expect(ls.length).toBe(1);
});
test('29 a clean file with no imports yields no links', async () => {
  expect((await links("let x = 1;\nfunction f() { return x; }\n")).length).toBe(0);
});
test('30 a second require on another line yields its own link', async () => {
  const ls = await links("let a = require('./lib.uc');\nlet b = require('./sub/deep.uc');\n");
  expect(ls.length).toBe(2);
  expect(targets(ls).some(t => /sub\/deep\.uc$/.test(t))).toBe(true);
});
