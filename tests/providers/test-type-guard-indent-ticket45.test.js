// Ticket 45 — the type-guard quick fix used to indent the guard body with a hardcoded
// tab regardless of the file's indent style. In a 2-space-indented file the inserted
// body must use the file's own unit (spaces), not a literal tab.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function guardEdits(code, file) {
  const diags = await server.getDiagnostics(code, file);
  const diag = diags.find(d => d.code === 'incompatible-function-argument');
  expect(diag).toBeDefined();
  const actions = await server.getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  const guard = actions.find(a => /type guard/i.test(a.title));
  expect(guard).toBeDefined();
  const changes = guard.edit.changes[`file://${file}`];
  return changes.map(e => e.newText).join('');
}

test('guard body matches a 2-space file (no hardcoded tab)', async () => {
  const code = 'function f(x) {\n  let r = split(x, ",");\n  return r;\n}\n';
  const file = `/tmp/t45-2space-${Date.now()}.uc`;
  const text = await guardEdits(code, file);
  expect(text).not.toContain('\t');
  expect(text).toContain('type(x)');
});

test('guard body matches a tab-indented file', async () => {
  const code = 'function f(x) {\n\tlet r = split(x, ",");\n\treturn r;\n}\n';
  const file = `/tmp/t45-tab-${Date.now()}.uc`;
  const text = await guardEdits(code, file);
  // A tab file legitimately uses tabs; just assert the guard is produced and the body
  // is indented one level deeper than the statement (two tabs somewhere).
  expect(text).toContain('type(x)');
  expect(text).toContain('\t\t');
});
