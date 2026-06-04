// Cross-file rename — edge-case matrix.
// Renaming a named export (from any site) edits the declaration, every usage, and
// the import/export specifiers workspace-wide. Default exports, aliased imports,
// builtins and invalid names are refused. Locals/params stay in-file.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

const ws = '/tmp/test-xrename-matrix';

const FILES = {
  'lib.uc':
`export function foo() { return 1; }
export function bar() { return foo(); }
export let CONST = 42;
export function gaz() { return 2; }
export function nsmem() { return 3; }
export function solo() { return 4; }
function spec_fn() { return 5; }
export { spec_fn };
export function withlocal(p) { let tmp = p + 1; return tmp + tmp; }
export default function dflt() { return 9; }
export function shd() { return 7; }
function realname() { return 8; }
export { realname as aliasedExport };
`,
  'main.uc':
`import { foo, CONST } from './lib';
import { gaz } from './lib';
import { spec_fn } from './lib';
import dflt from './lib';
let r = foo() + foo() + CONST;
let g = gaz();
let sp = spec_fn();
let d = dflt();
`,
  'other.uc':
`import { foo } from './lib';
let y = foo();
`,
  'aliased.uc':
`import { gaz as gz } from './lib';
let z = gz();
`,
  'nsuser.uc':
`import * as lib from './lib';
let q = lib.nsmem();
`,
  'unrel.uc':
`function foo() { return 9; }
let k = foo();
`,
  'shadower.uc':
`import { shd } from './lib';
let s = shd();
function gg() { let shd = 1; return shd + shd; }
`,
  'aliasimporter.uc':
`import { aliasedExport } from './lib';
let ae = aliasedExport();
`,
};

let server;
beforeAll(async () => {
  fs.mkdirSync(ws, { recursive: true });
  for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(path.join(ws, name), content);
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

function colOf(file, lineIdx, token, nth = 1) {
  const line = FILES[file].split('\n')[lineIdx];
  const re = new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  let m, count = 0;
  while ((m = re.exec(line)) !== null) { if (++count === nth) return m.index; }
  return line.indexOf(token);
}
// Returns { byFile: {basename: editCount}, newTexts: Set, edits: [...] }
async function rename(file, lineIdx, token, newName) {
  const fp = path.join(ws, file);
  const we = await server.getRename(FILES[file], fp, lineIdx, colOf(file, lineIdx, token), newName);
  const changes = (we && we.changes) || {};
  const byFile = {};
  const newTexts = new Set();
  for (const [uri, edits] of Object.entries(changes)) {
    byFile[path.basename(uri.replace('file://', ''))] = edits.length;
    edits.forEach((e) => newTexts.add(e.newText));
  }
  return { byFile, newTexts, fileCount: Object.keys(byFile).length };
}
async function prepare(file, lineIdx, token) {
  const fp = path.join(ws, file);
  return server.getPrepareRename(FILES[file], fp, lineIdx, colOf(file, lineIdx, token));
}

test('RN1: rename a named export from the export site edits decl, usages, specifiers', async () => {
  const { byFile } = await rename('lib.uc', 0, 'foo', 'baz');
  expect(byFile['lib.uc']).toBe(2);  // decl + usage in bar()
  expect(byFile['main.uc']).toBe(3); // import specifier + 2 usages
  expect(byFile['other.uc']).toBe(2); // import specifier + usage
});

test('RN2: rename the same export from an import site', async () => {
  const { byFile } = await rename('main.uc', 0, 'foo', 'baz');
  expect(byFile['lib.uc']).toBe(2);
  expect(byFile['main.uc']).toBe(3);
  expect(byFile['other.uc']).toBe(2);
});

test('RN3: rename from a usage site in another importer', async () => {
  const { byFile } = await rename('other.uc', 1, 'foo', 'baz');
  expect(byFile['lib.uc']).toBe(2);
  expect(byFile['main.uc']).toBe(3);
});

test('RN4: renaming foo never touches an unrelated same-named local in another file', async () => {
  const { byFile } = await rename('lib.uc', 0, 'foo', 'baz');
  expect(byFile['unrel.uc']).toBeUndefined();
});

test('RN5: every edit uses the new name', async () => {
  const { newTexts } = await rename('lib.uc', 0, 'foo', 'baz');
  expect([...newTexts]).toEqual(['baz']);
});

test('RN6: rename an exported VARIABLE', async () => {
  const { byFile } = await rename('lib.uc', 2, 'CONST', 'LIMIT');
  expect(byFile['lib.uc']).toBe(1); // declaration
  expect(byFile['main.uc']).toBe(2); // import specifier + usage
});

test('RN7: an aliased importer makes rename refuse (export site)', async () => {
  const { fileCount } = await rename('lib.uc', 3, 'gaz', 'gosh');
  expect(fileCount).toBe(0);
});

test('RN8: aliased rename also refused from the aliased import site', async () => {
  const { fileCount } = await rename('aliased.uc', 1, 'gz', 'gosh');
  expect(fileCount).toBe(0);
});

test('RN9: a default export refuses cross-file rename (export site)', async () => {
  const { fileCount } = await rename('lib.uc', 9, 'dflt', 'mk');
  expect(fileCount).toBe(0);
});

test('RN10: default export refused from the import site too', async () => {
  const { fileCount } = await rename('main.uc', 3, 'dflt', 'mk');
  expect(fileCount).toBe(0);
});

test('RN11: a named export with no importers renames in its file only', async () => {
  const { byFile, fileCount } = await rename('lib.uc', 5, 'solo', 'lonely');
  expect(byFile['lib.uc']).toBe(1);
  expect(fileCount).toBe(1);
});

test('RN12: `export { spec_fn }` specifier form renames decl + export + import specifiers', async () => {
  const { byFile } = await rename('main.uc', 6, 'spec_fn', 'specialized');
  expect(byFile['lib.uc']).toBe(2);  // declaration + export specifier
  expect(byFile['main.uc']).toBe(2); // import specifier + usage
});

test('RN13: a namespace-imported member renames decl + the `ns.member` usage', async () => {
  const { byFile } = await rename('lib.uc', 4, 'nsmem', 'nsM');
  expect(byFile['lib.uc']).toBe(1);   // declaration
  expect(byFile['nsuser.uc']).toBe(1); // lib.nsmem usage (import * untouched)
});

test('RN14: an exported-but-unused function renames in-file', async () => {
  const { byFile, fileCount } = await rename('lib.uc', 1, 'bar', 'baz2');
  expect(byFile['lib.uc']).toBe(1);
  expect(fileCount).toBe(1);
});

test('RN15: a function-local variable renames in-file (decl + usages)', async () => {
  const { byFile, fileCount } = await rename('lib.uc', 8, 'tmp', 'acc');
  expect(byFile['lib.uc']).toBe(3); // decl + 2 usages
  expect(fileCount).toBe(1);
});

test('RN16: a parameter renames in-file', async () => {
  const { byFile, fileCount } = await rename('lib.uc', 8, 'p', 'n');
  expect(byFile['lib.uc']).toBe(2); // param + usage
  expect(fileCount).toBe(1);
});

test('RN17: a local variable in an importer renames in-file', async () => {
  const { byFile, fileCount } = await rename('main.uc', 4, 'r', 'res');
  expect(fileCount).toBe(1);
  expect(byFile['main.uc']).toBeGreaterThanOrEqual(1);
});

test('RN18: an invalid new identifier is rejected', async () => {
  const fp = path.join(ws, 'lib.uc');
  const we = await server.getRename(FILES['lib.uc'], fp, 0, colOf('lib.uc', 0, 'foo'), '1bad');
  expect(we).toBeFalsy();
});

test('RN19: renaming a builtin is refused', async () => {
  // `return` line — use a builtin call; here we click a builtin name in a call.
  fs.writeFileSync(path.join(ws, 'b.uc'), `let x = length("hi");\n`);
  const we = await server.getRename(`let x = length("hi");\n`, path.join(ws, 'b.uc'), 0, 8, 'len');
  expect(we).toBeFalsy();
  fs.rmSync(path.join(ws, 'b.uc'), { force: true });
});

test('RN20: prepareRename returns a range for a renameable export', async () => {
  const r = await prepare('lib.uc', 0, 'foo');
  expect(r).toBeTruthy();
  expect(r.placeholder).toBe('foo');
});

test('RN21: prepareRename returns null for an aliased (refused) export', async () => {
  const r = await prepare('lib.uc', 3, 'gaz');
  expect(r).toBeFalsy();
});

test('RN22: prepareRename returns null for a default export', async () => {
  const r = await prepare('lib.uc', 9, 'dflt');
  expect(r).toBeFalsy();
});

test('RN24: a nested local shadow in an importer refuses the rename (no corruption)', async () => {
  // shadower.uc imports `shd` and also declares a nested `let shd` — a name-based
  // rename would corrupt the nested binding, so it must refuse.
  const { fileCount } = await rename('lib.uc', 10, 'shd', 'shdRenamed');
  expect(fileCount).toBe(0);
});

test('RN25: an export ALIAS (`export { realname as aliasedExport }`) refuses rename', async () => {
  const { fileCount } = await rename('aliasimporter.uc', 1, 'aliasedExport', 'renamed');
  expect(fileCount).toBe(0);
});

test('RN26: the export-alias is also refused from the source export specifier', async () => {
  const { fileCount } = await rename('lib.uc', 12, 'aliasedExport', 'renamed');
  expect(fileCount).toBe(0);
});

test('RN27: prepareRename returns null for a shadowed export', async () => {
  const r = await prepare('lib.uc', 10, 'shd');
  expect(r).toBeFalsy();
});

test('RN23: foo rename produces exactly one edit per occurrence (no dup ranges)', async () => {
  const fp = path.join(ws, 'lib.uc');
  const we = await server.getRename(FILES['lib.uc'], fp, 0, colOf('lib.uc', 0, 'foo'), 'baz');
  for (const edits of Object.values(we.changes)) {
    const keys = edits.map((e) => `${e.range.start.line}:${e.range.start.character}`);
    expect(keys.length).toBe(new Set(keys).size);
  }
});
