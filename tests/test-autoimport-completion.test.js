// Auto-import on completion: a named export from another workspace file is offered
// as a completion that, when accepted, inserts the `import { … } from '…'` via
// additionalTextEdits. Only in general (statement/expression) context, never in
// member position, and never duplicating an already-imported symbol.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

let dir, server;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucai-'));
  fs.writeFileSync(path.join(dir, 'lib.uc'),
    'export function helper() { return 1; }\nexport let CONST_VAL = 42;\n');
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const items = (c) => (Array.isArray(c) ? c : (c && c.items) || []);
async function complete(content, lineIdx, ch) {
  const fp = path.join(dir, 'main.uc');
  fs.writeFileSync(fp, content);
  await server.getDiagnostics(content, fp);
  return items(await server.getCompletions(content, fp, lineIdx, ch));
}

test('a cross-file named export is offered with an auto-import edit', async () => {
  const c = `let x = hel\n`;
  const h = (await complete(c, 0, c.indexOf('hel') + 3)).find(i => i.label === 'helper');
  expect(h).toBeTruthy();
  expect(h.additionalTextEdits).toBeTruthy();
  expect(h.additionalTextEdits[0].newText).toContain("import { helper } from './lib.uc';");
  expect(h.detail).toContain('Auto-import');
});

test('exported non-function values are offered too', async () => {
  const c = `let x = CONST\n`;
  const v = (await complete(c, 0, c.indexOf('CONST') + 5)).find(i => i.label === 'CONST_VAL');
  expect(v).toBeTruthy();
  expect(v.additionalTextEdits[0].newText).toContain("import { CONST_VAL } from './lib.uc';");
});

test('not offered in member position', async () => {
  const c = `let o = {};\no.hel\n`;
  const offered = (await complete(c, 1, 'o.hel'.length)).some(i => i.label === 'helper');
  expect(offered).toBe(false);
});

test('not duplicated when already imported', async () => {
  const c = `import { helper } from './lib.uc';\nlet x = hel\n`;
  const matches = (await complete(c, 1, 'let x = hel'.length)).filter(i => i.label === 'helper');
  // the in-scope import is offered once; the auto-import candidate is deduped away
  expect(matches.length).toBe(1);
  expect(matches[0].additionalTextEdits).toBeFalsy();
});

test('the auto-import edit lands after a leading use-strict + imports', async () => {
  const c = `'use strict';\nimport { x } from './other.uc';\nlet y = hel\n`;
  const h = (await complete(c, 2, 'let y = hel'.length)).find(i => i.label === 'helper');
  expect(h).toBeTruthy();
  // inserted on its own line after line 1 (the existing import), not at the very top
  expect(h.additionalTextEdits[0].range.start.line).toBeGreaterThan(0);
});
