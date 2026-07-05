// Quick-fix for UC6015 (a colon-block keyword whose opener lost its `:`): "Add ':' after the
// <opener> condition" — inserts the colon after the nearest matching opener (`if`/`elif`/`for`/
// `while`/`function`) whose condition isn't already colon-terminated. Applying it yields valid
// ucode colon-block syntax.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colon-qf-')); });
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const fp = () => path.join(dir, `t${n++}.uc`);
function applyEdits(code, edits) {
  const lines = code.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = code;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}
async function fixFor(code) {
  const file = fp();
  const diags = (await server.getDiagnostics(code, file)) || [];
  const d = diags.find((x) => x.code === 'UC6015');
  if (!d) return { d: null, code, file };
  const acts = (await server.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  return { d, code, file, act: acts.find((a) => /Add ':'/.test(a.title)), acts };
}
const applied = (r) => applyEdits(r.code, r.act.edit.changes[`file://${r.file}`]);

test('endif → offers "Add \':\' after the \'if\' condition" and inserts it correctly', async () => {
  const r = await fixFor("if (x)\n  print('a');\nendif\n");
  expect(r.act).toBeTruthy();
  expect(r.act.title).toContain("'if'");
  expect(applied(r)).toBe("if (x):\n  print('a');\nendif\n");
});
test('endfor → inserts the colon after the for header', async () => {
  const r = await fixFor("for (let i = 0; i < 2; i++)\n  print(i);\nendfor\n");
  expect(r.act.title).toContain("'for'");
  expect(applied(r)).toBe("for (let i = 0; i < 2; i++):\n  print(i);\nendfor\n");
});
test('endwhile → inserts the colon after the while header', async () => {
  const r = await fixFor("while (x)\n  print(x);\nendwhile\n");
  expect(applied(r)).toBe("while (x):\n  print(x);\nendwhile\n");
});
test('elif → adds the colon after the preceding `if` condition', async () => {
  // The elif fires because the `if` lacked a colon; the fix targets that `if`.
  const r = await fixFor("if (x)\n  print('a');\nelif (y)\n  print('b');\nendif\n");
  expect(r.act.title).toContain("'if'");
  expect(applied(r)).toContain("if (x):");
});
test('a genuinely stray `endif` (no opener at all) offers no fix rather than a wrong one', async () => {
  const r = await fixFor("print('a');\nendif\n");
  expect(r.d).toBeTruthy();      // still flagged UC6015
  expect(r.act).toBeUndefined(); // ...but no opener to add a colon to → no quick-fix
});
test('applying the fix yields a clean parse (no more UC6015 on that opener)', async () => {
  const r = await fixFor("for (let i = 0; i < 2; i++)\n  print(i);\nendfor\n");
  const out = applied(r);
  const diags = (await server.getDiagnostics(out, fp())) || [];
  expect(diags.some((x) => x.code === 'UC6015')).toBe(false);
});

// ── in-block elif that lost its own colon (if-colon present) ─────────────────
test('an `elif` missing its colon inside a colon-block gets UC6015 + a fix on the elif', async () => {
  // `if (x):` is a valid colon-block; `elif (y)` forgot its `:`. Was a cryptic UC6001 on the
  // NEXT token with no fix; now a UC6015 on the elif condition, quick-fixable.
  const r = await fixFor("if (x):\n  print('a');\nelif (y)\n  print('b');\nendif\n");
  expect(r.d).toBeTruthy();
  expect(r.act.title).toContain("'elif'");
  expect(applied(r)).toContain("elif (y):");
});
test('the broken elif no longer cascade-suppresses a later block (endfor still flagged)', async () => {
  const code = "if (x):\n  print('a');\nelif (y)\n  print('b');\nendif\n\nfor (let i = 0; i < 2; i++)\n  print(i);\nendfor\n";
  const d = (await server.getDiagnostics(code, fp())) || [];
  const u = d.filter((x) => x.code === 'UC6015');
  expect(u.length).toBe(2);               // the elif AND the endfor
  expect(d.some((x) => x.code === 'UC6001')).toBe(false); // no cryptic "Expected ':'"
});
