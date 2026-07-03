// Quick fix for UC8010 (blocking recv on a socketpair): add MSG_DONTWAIT to make the read
// non-blocking, auto-importing socket's MSG_DONTWAIT when it isn't already in scope. Prefers
// an existing `import * as socket` (→ socket.MSG_DONTWAIT), then a named import, else adds one.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brecv-qf-')); });
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const fp = () => path.join(dir, `t${Math.random().toString(36).slice(2)}.uc`);
// Apply a set of TextEdits to source (sorted by descending start so offsets stay valid).
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
  const d = diags.find((x) => x.code === 'UC8010');
  if (!d) return { act: null, file, code };
  const acts = (await server.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  const act = acts.find((a) => /non-blocking/.test(a.title));
  return { act, file, code };
}
const applied = (r) => applyEdits(r.code, r.act.edit.changes[`file://${r.file}`]);

test('named-import file: adds MSG_DONTWAIT + a new socket import', async () => {
  const r = await fixFor("import { pair } from 'socket';\nlet sox = pair();\nlet rx = sox[0].recv(10);\n");
  expect(r.act).toBeTruthy();
  const out = applied(r);
  expect(out).toContain('recv(10, MSG_DONTWAIT)');
  expect(out).toContain("import { MSG_DONTWAIT } from 'socket';");
});

test('namespace-import file: uses socket.MSG_DONTWAIT, NO new import', async () => {
  const r = await fixFor("import { pair } from 'socket';\nimport * as socket from 'socket';\nlet sox = pair();\nlet rx = sox[0].recv(10);\n");
  const out = applied(r);
  expect(out).toContain('recv(10, socket.MSG_DONTWAIT)');
  expect(out).not.toContain("import { MSG_DONTWAIT }");
});

test('MSG_DONTWAIT already imported: inserts it, adds NO duplicate import', async () => {
  const r = await fixFor("import { pair, MSG_DONTWAIT } from 'socket';\nlet sox = pair();\nlet rx = sox[0].recv(10);\n");
  const out = applied(r);
  expect(out).toContain('recv(10, MSG_DONTWAIT)');
  // the import line is unchanged (still the single original)
  expect(out.match(/import \{ pair, MSG_DONTWAIT \}/g).length).toBe(1);
});

test('existing (non-DONTWAIT) flags arg: ORs the flag into it', async () => {
  const r = await fixFor("import { pair, MSG_PEEK } from 'socket';\nlet sox = pair();\nlet rx = sox[0].recv(10, MSG_PEEK);\n");
  const out = applied(r);
  expect(out).toContain('recv(10, MSG_PEEK | MSG_DONTWAIT)');
});

test('the action is marked preferred', async () => {
  const r = await fixFor("import { pair } from 'socket';\nlet sox = pair();\nlet rx = sox[0].recv(10);\n");
  expect(r.act.isPreferred).toBe(true);
});
