// Ticket 95 — the Add-JSDoc quick fix bailed on ANY leading JSDoc, so a function with a
// PARTIAL block (some params documented) got no help. generateJsDocQuickFix must now offer
// a "Complete JSDoc" variant that appends the missing @param lines into the existing block.
//
// Reached here via the call-site trigger (incompatible-function-argument on an undocumented
// param). NOTE: the UC7003 "missing @param" hint is separately gated on `!leadingJsDoc` in
// the analyzer, so it does not fire for partial blocks — that gate is out of scope here.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

test('offers "Complete JSDoc" that appends only the missing @param to the existing block', async () => {
  const code = [
    '/**',
    ' * @param {string} a',
    ' */',
    'function f(a, b) {',
    '  return split(b, ",");',
    '}',
    '',
  ].join('\n');
  const file = `/tmp/t95-partial-${Date.now()}.uc`;
  const diags = await server.getDiagnostics(code, file);
  const diag = diags.find(d => d.code === 'incompatible-function-argument');
  expect(diag).toBeDefined();

  const actions = await server.getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  const complete = actions.find(a => /complete jsdoc/i.test(a.title));
  expect(complete).toBeDefined();

  const edits = complete.edit.changes[`file://${file}`];
  expect(edits.length).toBe(1);
  const nt = edits[0].newText;
  // Appends `b`, and does NOT re-emit a whole new /** block.
  expect(nt).toContain('@param');
  expect(nt).toContain('b');
  expect(nt).not.toContain('/**');
  // The insert lands before the closing `*/` (line 2 of the block).
  expect(edits[0].range.start.line).toBe(2);
});

test('appends only the truly-missing params, preserving documented ones', async () => {
  // a AND c documented, b missing; b is the undocumented param passed to split().
  const code = [
    '/**',
    ' * @param {string} a',
    ' * @param {string} c',
    ' */',
    'function f(a, b, c) {',
    '  return split(b, ",");',
    '}',
    '',
  ].join('\n');
  const file = `/tmp/t95-multi-${Date.now()}.uc`;
  const diags = await server.getDiagnostics(code, file);
  const diag = diags.find(d => d.code === 'incompatible-function-argument');
  expect(diag).toBeDefined();

  const actions = await server.getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  const complete = actions.find(a => /complete jsdoc/i.test(a.title));
  expect(complete).toBeDefined();
  const nt = complete.edit.changes[`file://${file}`][0].newText;
  // Only `b` is appended (a and c already documented).
  expect(nt).toContain('b');
  expect(nt).not.toMatch(/@param[^\n]*\ba\b/);
  expect(nt).not.toMatch(/@param[^\n]*\bc\b/);
});
