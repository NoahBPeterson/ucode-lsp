// Ticket 93 — the "add import" named quick fix used to always add a second
// `import { X } from 'mod';` line even when the file already imported from that
// module. It must now merge the new specifier into the existing brace list.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function addImportActions(code, file) {
  const diags = await server.getDiagnostics(code, file);
  // The unresolved `fs.open(...)` receiver produces a UC1001/UC3006-style diagnostic on `fs`.
  const diag = diags.find(d => d.range.start.line === code.split('\n').findIndex(l => l.includes('fs.open')));
  expect(diag).toBeDefined();
  return server.getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
}

test('named add-import merges into an existing import from the same module', async () => {
  const code = "import { readfile } from 'fs';\nlet x = fs.open('/etc/hosts');\n";
  const file = `/tmp/t93-merge-${Date.now()}.uc`;
  const actions = await addImportActions(code, file);
  const named = actions.find(a => /import \{ open \}/.test(a.title));
  expect(named).toBeDefined();
  const edits = named.edit.changes[`file://${file}`];
  const importEdit = edits.find(e => e.newText.includes('open'));
  // Merge = a small in-place insert (", open"), NOT a whole new `import { open } ...` line.
  expect(importEdit.newText).not.toContain('import {');
  expect(importEdit.newText.replace(/\s/g, '')).toContain(',open');
});

test('named add-import adds a fresh line when no import from the module exists', async () => {
  const code = "let x = fs.open('/etc/hosts');\n";
  const file = `/tmp/t93-fresh-${Date.now()}.uc`;
  const actions = await addImportActions(code, file);
  const named = actions.find(a => /import \{ open \}/.test(a.title));
  expect(named).toBeDefined();
  const edits = named.edit.changes[`file://${file}`];
  const importEdit = edits.find(e => e.newText.includes('open'));
  expect(importEdit.newText).toContain("import { open } from 'fs';");
});
