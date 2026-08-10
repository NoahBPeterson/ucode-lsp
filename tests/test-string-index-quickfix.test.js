// UC5003 string-index quick fix (0.8.7): `s[i]` is a runtime error in ucode
// (vm.c uc_vm_insn_load_val accepts only array/object/resource receivers) —
// the fix rewrites the whole member expression to `substr(s, i, 1)`, slicing
// the receiver and index verbatim from their AST node offsets.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function fixFor(codeLines) {
  const code = codeLines.join('\n');
  const p = `/tmp/stridx-${n++}.uc`;
  const diags = await server.getDiagnostics(code, p);
  const d = (diags || []).find((x) => String(x.code) === 'UC5003' && /cannot be indexed/.test(x.message));
  if (!d) return { code, diag: null, action: null };
  const acts = await server.getCodeActions(p, [d], d.range.start.line, d.range.start.character + 1);
  const action = (acts || []).find((a) => a.title.startsWith('Replace with substr('));
  return { code, diag: d, action, uri: `file://${p}` };
}

function applied(code, action, uri) {
  const edit = action.edit.changes[uri][0];
  const lines = code.split('\n');
  const l = edit.range.start.line;
  lines[l] = lines[l].slice(0, edit.range.start.character) + edit.newText + lines[l].slice(edit.range.end.character);
  return lines.join('\n');
}

test('simple identifier receiver + literal index', async () => {
  const { code, diag, action, uri } = await fixFor([
    'let s = "hello";',
    'let c = s[0];',
    'print(c);']);
  expect(diag).toBeTruthy();
  expect(action).toBeTruthy();
  expect(action.title).toBe('Replace with substr(s, 0, 1)');
  expect(action.isPreferred).toBe(true);
  const after = applied(code, action, uri);
  expect(after).toContain('let c = substr(s, 0, 1);');
  // The rewritten file is clean of the string-index error.
  const d2 = await server.getDiagnostics(after, `/tmp/stridx-${n++}.uc`);
  expect((d2 || []).filter((x) => /cannot be indexed/.test(x.message))).toEqual([]);
});

test('variable index and member receiver survive verbatim', async () => {
  const { action } = await fixFor([
    'let cfg = { name: "router" };',
    'let i = 2;',
    'print(cfg.name[i + 1]);']);
  expect(action).toBeTruthy();
  expect(action.title).toBe('Replace with substr(cfg.name, i + 1, 1)');
});

test('call-expression receiver', async () => {
  const { code, action, uri } = await fixFor([
    'let parts = split("a:b", ":");',
    'print(join("", parts)[1]);']);
  expect(action).toBeTruthy();
  expect(action.title).toBe('Replace with substr(join("", parts), 1, 1)');
  const after = applied(code, action, uri);
  expect(after).toContain('print(substr(join("", parts), 1, 1));');
});

test('no fix offered on legitimate array indexing', async () => {
  const code = ['let a = [1, 2, 3];', 'print(a[0]);'].join('\n');
  const p = `/tmp/stridx-${n++}.uc`;
  const diags = await server.getDiagnostics(code, p);
  expect((diags || []).filter((x) => /cannot be indexed/.test(x.message))).toEqual([]);
});
