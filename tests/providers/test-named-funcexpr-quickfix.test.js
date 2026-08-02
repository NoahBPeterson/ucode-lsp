// E2e code-action tests for the named-funcexpr-in-initializer UC6005 quick fix
// (docs/named-funcexpr-let-const-crash.md). When the name is unused in the body,
// the fix deletes it (`function g(n)` -> `function (n)`); when the body references
// the name (self-recursion), no edit is offered - the message directs the user to a
// function declaration instead. The retarget command is always present.
import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics, getCodeActions;

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

function applyEdits(code, edits) {
  // single-line inserts/deletes; apply in descending start order
  const off = (p) => code.split('\n').slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = code;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}

describe('Named-funcexpr UC6005 quick fix (e2e)', () => {
  test('unused name: "Remove the function name" yields an anonymous funcexpr', async () => {
    const code = 'let f = function g(n) { return n; };\nprint(f(1), "\\n");\n';
    const diags = await getDiagnostics(code, '/tmp/nfx-a.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    expect(gate).toBeDefined();
    const actions = await getCodeActions('/tmp/nfx-a.uc', [gate], gate.range.start.line, gate.range.start.character);
    const fix = actions.find((a) => a.title === 'Remove the function name');
    expect(fix).toBeDefined();
    const edits = Object.values(fix.edit.changes)[0];
    expect(applyEdits(code, edits)).toBe('let f = function (n) { return n; };\nprint(f(1), "\\n");\n');
  });

  test('self-recursive name: no removal fix, retarget still offered', async () => {
    const code = 'let f = function g(n) { return n < 2 ? 1 : n * g(n - 1); };\nprint(f(4), "\\n");\n';
    const diags = await getDiagnostics(code, '/tmp/nfx-b.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    expect(gate).toBeDefined();
    const actions = await getCodeActions('/tmp/nfx-b.uc', [gate], gate.range.start.line, gate.range.start.character);
    const titles = actions.map((a) => a.title);
    expect(titles).not.toContain('Remove the function name');
    expect(titles).toContain('Target a different OpenWrt release…');
  });
});

describe('For-leading-declarator UC6005 quick fix (e2e)', () => {
  test('`Initialize it: = null` produces for (let acc = null, i = 0; ...)', async () => {
    const code = 'for (let acc, i = 0; i < 3; i++) {\n    acc ??= 0;\n}\n';
    const diags = await getDiagnostics(code, '/tmp/fld-a.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    expect(gate).toBeDefined();
    const actions = await getCodeActions('/tmp/fld-a.uc', [gate], gate.range.start.line, gate.range.start.character);
    const fix = actions.find((a) => a.title === 'Initialize it: `= null`');
    expect(fix).toBeDefined();
    const edits = Object.values(fix.edit.changes)[0];
    expect(applyEdits(code, edits)).toBe('for (let acc = null, i = 0; i < 3; i++) {\n    acc ??= 0;\n}\n');
  });
});
