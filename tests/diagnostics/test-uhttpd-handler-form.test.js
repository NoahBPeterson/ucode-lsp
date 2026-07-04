// Phase D — authoring help for uhttpd handlers.
//   FN-1 (UC8012): a file registers `global.handle_request` but isn't a `{%` template →
//     uhttpd emits the file as the response body and runs nothing. Quick-fix wraps in `{% %}`.
//   FN-2 (UC8013): a `{%` template defines `handle_request` in a form uhttpd's scope lookup
//     can't see (local function / export / let-const). Quick-fix converts to `global.handle_request`.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uhh-form-')); });
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
async function run(code, wantCode) {
  const file = fp();
  const diags = (await server.getDiagnostics(code, file)) || [];
  const d = diags.find((x) => x.code === wantCode);
  if (!d) return { d: null, code, file, diags };
  const acts = (await server.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  return { d, code, file, act: acts.find((a) => a.kind === 'quickfix'), acts };
}
const applied = (r) => applyEdits(r.code, r.act.edit.changes[`file://${r.file}`]);

// ── FN-1 (UC8012) ─────────────────────────────────────────────────────────────
test('global.handle_request in a plain script is flagged UC8012', async () => {
  const r = await run("global.handle_request = function(env) { return env; };\n", 'UC8012');
  expect(r.d).toBeTruthy();
  expect(r.d.message).toContain('must be a `{% … %}` template');
});
test('UC8012 quick-fix wraps the file in a `{% %}` template', async () => {
  const r = await run("global.handle_request = function(env) { return env; };\n", 'UC8012');
  const out = applied(r);
  expect(out.startsWith('{%\n')).toBe(true);
  expect(out.trimEnd().endsWith('%}')).toBe(true);
  expect(out).toContain('global.handle_request = function(env)');
});
test('UC8012 wrap keeps a shebang line outside the template', async () => {
  const r = await run("#!/usr/bin/ucode\nglobal.handle_request = function(env) { return env; };\n", 'UC8012');
  const out = applied(r);
  expect(out.startsWith('#!/usr/bin/ucode\n{%\n')).toBe(true);
});

// ── FN-2 (UC8013) ─────────────────────────────────────────────────────────────
test('local `function handle_request` in a template is flagged UC8013', async () => {
  const r = await run("{% function handle_request(env) { return env; } %}\n", 'UC8013');
  expect(r.d).toBeTruthy();
  expect(r.d.message).toContain('global scope');
});
test('UC8013 quick-fix converts a local function to global.handle_request', async () => {
  const r = await run("{% function handle_request(env) { return env; } %}\n", 'UC8013');
  expect(applied(r)).toContain('global.handle_request = function(env) { return env; };');
});
test('exported `function handle_request` is flagged and converts', async () => {
  const r = await run("{% export function handle_request(env) { return env; } %}\n", 'UC8013');
  expect(r.d).toBeTruthy();
  expect(applied(r)).toContain('global.handle_request = function(env) { return env; };');
});
test('a `let handle_request = fn` binding is flagged and converts', async () => {
  const r = await run("{% let handle_request = function(env) { return env; }; %}\n", 'UC8013');
  expect(r.d).toBeTruthy();
  expect(applied(r)).toContain('global.handle_request = function(env) { return env; };');
});
test('the wrong-form local function does NOT also get a UC1006 "unused" (template intent)', async () => {
  const file = fp();
  const diags = (await server.getDiagnostics("{% function handle_request(env) { return env; } %}\n", file)) || [];
  expect(diags.some((d) => d.code === 'UC1006' && d.message.includes('handle_request'))).toBe(false);
});

// ── must stay clean ───────────────────────────────────────────────────────────
test('a correct handler (`{% global.handle_request = fn %}`) has neither UC8012 nor UC8013', async () => {
  const code = "{%\nglobal.handle_request = function(env) { return env; };\n%}\n";
  const diags = (await server.getDiagnostics(code, fp())) || [];
  expect(diags.some((d) => d.code === 'UC8012' || d.code === 'UC8013')).toBe(false);
});
test('a plain script with no handle_request is untouched', async () => {
  const diags = (await server.getDiagnostics("let x = 1;\nprint(x);\n", fp())) || [];
  expect(diags.some((d) => d.code === 'UC8012' || d.code === 'UC8013')).toBe(false);
});
