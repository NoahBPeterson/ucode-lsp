// Cross-file rename: renaming a named export (from either the export site or an
// import site) edits the declaration, every usage, AND the import/export specifiers
// across the workspace. Aliased imports and default exports are refused (sound).
const { test, expect, beforeEach, afterEach } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

const ws = '/tmp/test-xrename-suite';
const libPath = path.join(ws, 'lib.uc');
const mainPath = path.join(ws, 'main.uc');

function writeFiles(files) {
  fs.mkdirSync(ws, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(ws, name), content);
}
afterEach(() => { try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

// fileCount + per-file edited line set
async function rename(openName, line, findStr, newName) {
  const s = createLSPTestServer({ workspaceRoot: ws });
  try {
    await s.initialize();
    const fp = path.join(ws, openName);
    const content = fs.readFileSync(fp, 'utf8');
    const ch = content.split('\n')[line].indexOf(findStr);
    const we = await s.getRename(content, fp, line, ch, newName);
    const changes = (we && we.changes) || {};
    const byFile = {};
    for (const [uri, edits] of Object.entries(changes)) {
      byFile[path.basename(uri.replace('file://', ''))] = edits.length;
    }
    return byFile;
  } finally {
    s.shutdown();
  }
}

test('rename a named export from the import site edits both files (incl. specifiers)', async () => {
  writeFiles({
    'lib.uc': `export function foo() { return 1; }\nexport function bar() { return foo(); }\n`,
    'main.uc': `import { foo } from './lib';\nlet a = foo();\n`,
  });
  // cursor on `foo` in main.uc usage (line 1)
  const byFile = await rename('main.uc', 1, 'foo', 'baz');
  // lib.uc: declaration + usage in bar() = 2 edits
  expect(byFile['lib.uc']).toBe(2);
  // main.uc: import specifier + usage = 2 edits
  expect(byFile['main.uc']).toBe(2);
});

test('rename a named export from the export site edits both files', async () => {
  writeFiles({
    'lib.uc': `export function foo() { return 1; }\n`,
    'main.uc': `import { foo } from './lib';\nlet a = foo();\nlet b = foo();\n`,
  });
  // cursor on `foo` in lib.uc declaration (line 0)
  const byFile = await rename('lib.uc', 0, 'foo', 'baz');
  expect(byFile['lib.uc']).toBe(1);  // declaration
  expect(byFile['main.uc']).toBe(3); // import specifier + 2 usages
});

test('an aliased importer makes the rename refuse (no edits)', async () => {
  writeFiles({
    'lib.uc': `export function foo() { return 1; }\n`,
    'main.uc': `import { foo as f } from './lib';\nlet a = f();\n`,
  });
  const byFile = await rename('lib.uc', 0, 'foo', 'baz');
  expect(Object.keys(byFile).length).toBe(0);
});

test('a default export refuses cross-file rename', async () => {
  writeFiles({
    'lib.uc': `export default function make() { return {}; }\n`,
    'main.uc': `import mk from './lib';\nlet a = mk();\n`,
  });
  const byFile = await rename('lib.uc', 0, 'make', 'maker');
  expect(Object.keys(byFile).length).toBe(0);
});

test('a purely-local variable still renames in-file only', async () => {
  writeFiles({
    'lib.uc': `export function foo() { let temp = 1; return temp + temp; }\n`,
  });
  const byFile = await rename('lib.uc', 0, 'temp', 'val');
  expect(byFile['lib.uc']).toBe(3); // declaration + 2 usages
  expect(Object.keys(byFile).length).toBe(1);
});
