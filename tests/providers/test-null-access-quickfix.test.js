// Quick fixes for the null-access diagnostics (UC5005 provably-null / UC5006 possibly-null):
//   1. Optional chaining — `.`→`?.` (or `[`→`?.[`). Not offered on an assignment LHS.
//   2. Null guard — wrap the statement in `if (receiver) …`. Identifier receivers only
//      (a direct call like `cursor()` must not be evaluated twice).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-qf-')); });
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const fp = () => path.join(dir, `t${Math.random().toString(36).slice(2)}.uc`);
function applyEdit(code, edit) {
  const lines = code.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  return code.slice(0, off(edit.range.start)) + edit.newText + code.slice(off(edit.range.end));
}
async function actionsFor(code, matchRe) {
  const file = fp();
  const diags = (await server.getDiagnostics(code, file)) || [];
  const d = diags.find((x) => matchRe.test(x.message));
  if (!d) return { titles: [], acts: [], file, diag: null };
  const acts = (await server.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  return { titles: acts.map((a) => a.title), acts, file, diag: d };
}
const editOf = (acts, file, titleRe) => {
  const a = acts.find((x) => titleRe.test(x.title));
  return a && a.edit.changes[`file://${file}`][0];
};

// ── Tier 1 (provably null) ───────────────────────────────────────────────────
test('Tier 1 read offers optional chaining and a guard', async () => {
  const { titles } = await actionsFor('let u;\nu.field;\n', /null value/);
  expect(titles).toContain("Use optional chaining ('?.')");
  expect(titles.some((t) => /Guard with 'if \(u\)'/.test(t))).toBe(true);
});
test('Tier 1 optional-chaining edit turns u.field into u?.field', async () => {
  const code = 'let u;\nu.field;\n';
  const { acts, file } = await actionsFor(code, /null value/);
  expect(applyEdit(code, editOf(acts, file, /optional chaining/))).toContain('u?.field;');
});
test('Tier 1 guard edit wraps the statement in if (u)', async () => {
  const code = 'let u;\nu.field;\n';
  const { acts, file } = await actionsFor(code, /null value/);
  expect(applyEdit(code, editOf(acts, file, /Guard/))).toContain('if (u) u.field;');
});
test('Tier 1 computed index offers the ?.[ optional-chaining form', async () => {
  const code = 'let u;\nu[0];\n';
  const { acts, file, titles } = await actionsFor(code, /null value/);
  expect(titles).toContain("Use optional chaining ('?.[')");
  expect(applyEdit(code, editOf(acts, file, /optional chaining/))).toContain('u?.[0];');
});
test('Tier 1 WRITE offers a guard but NOT optional chaining (invalid on assignment LHS)', async () => {
  const { titles } = await actionsFor('let w;\nw.field = 1;\n', /null value/);
  expect(titles.some((t) => /optional chaining/.test(t))).toBe(false);
  expect(titles.some((t) => /Guard with 'if \(w\)'/.test(t))).toBe(true);
});

// ── Tier 2 (possibly null) ───────────────────────────────────────────────────
test('Tier 2 stored handle offers both fixes', async () => {
  const { titles } = await actionsFor('import { open } from "fs";\nlet fh = open("/x");\nfh.read(64);\n', /may be null/);
  expect(titles).toContain("Use optional chaining ('?.')");
  expect(titles.some((t) => /Guard with 'if \(fh\)'/.test(t))).toBe(true);
});
test('Tier 2 direct call-chain offers optional chaining but NOT a guard (no double-eval)', async () => {
  const { titles } = await actionsFor('import { cursor } from "uci";\ncursor().foreach("a", "b", (s) => {});\n', /may be null/);
  expect(titles).toContain("Use optional chaining ('?.')");
  expect(titles.some((t) => /^Guard with/.test(t))).toBe(false);
});
test('Tier 2 direct-chain optional-chaining edit is cursor()?.foreach(...)', async () => {
  const code = 'import { cursor } from "uci";\ncursor().foreach("a", "b", (s) => {});\n';
  const { acts, file } = await actionsFor(code, /may be null/);
  expect(applyEdit(code, editOf(acts, file, /optional chaining/))).toContain('cursor()?.foreach(');
});

// ── Applying a fix clears the diagnostic ─────────────────────────────────────
test('applying optional chaining clears the Tier 2 warning', async () => {
  const code = 'import { open } from "fs";\nlet fh = open("/x");\nfh.read(64);\n';
  const { acts, file } = await actionsFor(code, /may be null/);
  const fixed = applyEdit(code, editOf(acts, file, /optional chaining/));
  const after = ((await server.getDiagnostics(fixed, fp())) || []).filter((x) => /may be null|null value/.test(x.message));
  expect(after).toEqual([]);
});
test('applying the guard clears the Tier 1 error', async () => {
  const code = 'let u;\nu.field;\n';
  const { acts, file } = await actionsFor(code, /null value/);
  const fixed = applyEdit(code, editOf(acts, file, /Guard/));
  const after = ((await server.getDiagnostics(fixed, fp())) || []).filter((x) => /null value/.test(x.message));
  expect(after).toEqual([]);
});
