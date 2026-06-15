// #92 — the UC3006 "add import" quick fix for a `module.method()` use. The old PREFERRED fix
// inserted `import { method }` but left the call `module.method()` referencing an unbound
// `module` (Reference error). Now: the namespace import (which works as-is) is preferred, and
// the named-import variant ALSO rewrites the call site to the bare name, so neither is broken.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

async function uc3006Actions(code) {
  const path = `/tmp/uc3006-${n++}.uc`;
  const ds = (await s.getDiagnostics(code, path)) || [];
  const u = ds.find((d) => d.code === 'UC3006');
  if (!u) return { u: null, actions: [], path };
  const actions = (await s.getCodeActions(path, [u], u.range.start.line, u.range.start.character)) || [];
  return { u, actions: actions.filter((a) => /^Add /.test(a.title)), path };
}
// apply a code action's edits to the source (single-line, simultaneous, original-offset based)
function applyEdits(code, edits) {
  // sort by start offset descending so earlier edits don't shift later ranges
  const lines = code.split('\n');
  const off = (p) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = code;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}

test('the namespace import is preferred and works as-is', async () => {
  const code = 'let x = fs.open("/tmp/a");\n';
  const { actions, path } = await uc3006Actions(code);
  const pref = actions.find((a) => a.isPreferred);
  expect(pref).toBeTruthy();
  expect(pref.title).toContain('import * as fs');
  const result = applyEdits(code, pref.edit.changes[`file://${path}`]);
  expect(result).toContain("import * as fs from 'fs';");
  expect(result).toContain('fs.open("/tmp/a")'); // call unchanged, now valid
});

test('the named-import variant rewrites the call so it is not left broken', async () => {
  const code = 'let x = fs.open("/tmp/a");\n';
  const { actions, path } = await uc3006Actions(code);
  const named = actions.find((a) => a.title.includes('import { open }'));
  expect(named).toBeTruthy();
  expect(named.isPreferred).toBeFalsy();
  const result = applyEdits(code, named.edit.changes[`file://${path}`]);
  expect(result).toContain("import { open } from 'fs';");
  expect(result).toContain('let x = open("/tmp/a");'); // fs. dropped — no unbound reference
  expect(result).not.toContain('fs.open');
});
