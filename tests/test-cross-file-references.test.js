// Cross-file references: a `textDocument/references` query from an IMPORT SITE
// resolves to the declaring file and fans out across the whole workspace.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

const ws = '/tmp/test-xref-suite';
const libPath = path.join(ws, 'lib.uc');
const mainPath = path.join(ws, 'main.uc');
const otherPath = path.join(ws, 'other.uc');

beforeAll(() => {
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(libPath, `export function foo() { return 1; }\nexport function bar() { return foo(); }\n`);
  fs.writeFileSync(mainPath, `import { foo } from './lib';\nlet a = foo();\nlet b = foo();\n`);
  fs.writeFileSync(otherPath, `import { foo } from './lib';\nlet c = foo();\n`);
});
afterAll(() => { try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

// Returns a set of "basename:line" strings for the reference locations.
async function refsAt(openPath, line, character) {
  const s = createLSPTestServer({ workspaceRoot: ws });
  try {
    await s.initialize();
    const content = fs.readFileSync(openPath, 'utf8');
    const refs = (await s.getReferences(content, openPath, line, character, true)) || [];
    return refs.map((r) => `${path.basename(r.uri.replace('file://', ''))}:${r.range.start.line}`);
  } finally {
    s.shutdown();
  }
}

test('references from an import site reach the declaring file and all importers', async () => {
  // cursor on `foo` in main.uc `let a = foo();` (line 1)
  const got = await refsAt(mainPath, 1, fs.readFileSync(mainPath, 'utf8').split('\n')[1].indexOf('foo'));
  // lib.uc: declaration (line 0) + usage in bar() (line 1)
  expect(got).toContain('lib.uc:0');
  expect(got).toContain('lib.uc:1');
  // main.uc: both usages (lines 1,2)
  expect(got).toContain('main.uc:1');
  expect(got).toContain('main.uc:2');
  // other.uc: its usage (line 1) — proves it fanned out beyond the open file
  expect(got).toContain('other.uc:1');
});

test('references from the export site also span the workspace (pre-existing path)', async () => {
  // cursor on `foo` in lib.uc declaration `export function foo()` (line 0)
  const got = await refsAt(libPath, 0, fs.readFileSync(libPath, 'utf8').split('\n')[0].indexOf('foo'));
  expect(got).toContain('main.uc:1');
  expect(got).toContain('other.uc:1');
});
