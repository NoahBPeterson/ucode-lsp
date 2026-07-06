// UC8004 (a bare `x = …` that leaks an implicit global) offers a "Declare 'x' as a local
// (let x;)" quick-fix — the preferred fix, since a bare assignment is usually a forgotten `let`.
// Applying it inserts `let x;` at the top and clears the diagnostic. The explicit-global fixes
// (seed default / @global) remain as secondary options.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let s, dir, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc8004-')); });
afterAll(() => { try { s.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const CODE = "function ubi_init(ctx) {\n\tcursor = ctx.cursor;\n}\nfunction other() { return cursor.get(); }\n";

function apply(code, edit, file) {
  const lines = code.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  return code.slice(0, off(edit.range.start)) + edit.newText + code.slice(off(edit.range.end));
}

test('UC8004 offers a preferred "declare as local" quick-fix, plus the global options', async () => {
  const file = path.join(dir, 'q.uc');
  const d = (await s.getDiagnostics(CODE, file) || []).find((x) => x.code === 'UC8004');
  expect(d).toBeTruthy();
  const acts = (await s.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  const local = acts.find((a) => /Declare 'cursor' as a local/.test(a.title));
  expect(local).toBeTruthy();
  expect(local.isPreferred).toBe(true);
  // the explicit-global alternatives are still there
  expect(acts.some((a) => /global\.cursor = null/.test(a.title))).toBe(true);
  expect(acts.some((a) => /@global/.test(a.title))).toBe(true);
});

test('applying "declare as local" inserts `let cursor;` at the top and clears UC8004', async () => {
  const file = path.join(dir, 'q2.uc');
  const d = (await s.getDiagnostics(CODE, file) || []).find((x) => x.code === 'UC8004');
  const acts = (await s.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  const local = acts.find((a) => /Declare 'cursor' as a local/.test(a.title));
  const edit = local.edit.changes[`file://${file}`][0];
  expect(edit.newText).toBe('let cursor;\n');
  const fixed = apply(CODE, edit, file);
  expect(fixed.startsWith('let cursor;\n')).toBe(true);
  const after = (await s.getDiagnostics(fixed, path.join(dir, 'q3.uc')) || []).filter((x) => x.code === 'UC8004');
  expect(after.length).toBe(0);
});
