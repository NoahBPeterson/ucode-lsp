// UC8011 — parse-mode mismatch hazards in uhttpd handlers (corrected 0.8.7).
// uhttpd's ucode plugin runs the handler VM in TEMPLATE mode (uhttpd ucode.c's
// parse config sets no raw_mode), and loadfile()/include() inherit the VM's
// mode — so a RAW `.uc` file compiles as a template and its source is EMITTED
// AS RESPONSE TEXT instead of executing (container-verified: `ucode -T` +
// include/loadfile of a raw file echoes the code verbatim). That silent
// wrong-output + source disclosure is what sank the original loadfile-dispatcher
// (the old "uncatchable VM abort" story was a misdiagnosis — uhttpd's exception
// handler prints a Status: 500 page). Consequences:
//   - include('x.ut', scope) of a TEMPLATE is uhttpd's NATIVE composition
//     mechanism (uspot ships 15 of them) — never flagged.
//   - include/loadfile of a literal `.uc` path — ERROR (code leaks as text).
//   - loadfile with a non-.uc/dynamic path — WARNING (template-compiled closure
//     is almost never what a handler wants; static import is the fix).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/vmabort-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const codesOf = async (code, c) => (await diags(code)).filter((d) => d.code === c);

// A handler wrapper: `{%` template that registers global.handle_request, with `body` inside.
const handler = (body) => `{%\nglobal.handle_request = function(env) {\n${body}\n};\n%}\n`;

// ── raw-code paths must flag ──────────────────────────────────────────────────
test('loadfile("x.uc")() in a handler is an ERROR (source echoed as text)', async () => {
  const ds = await codesOf(handler("  let x = loadfile('/x.uc')();"), 'UC8011');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('TEMPLATE');
});
test('include("x.uc") in a handler is an ERROR (source echoed as text)', async () => {
  const ds = await codesOf(handler("  include('./helpers.uc');"), 'UC8011');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
});
test('a top-level loadfile of .uc in the handler template is flagged', async () => {
  const code = "{%\nlet cfg = loadfile('/c.uc')();\nglobal.handle_request = function(env) { return cfg; };\n%}\n";
  expect((await codesOf(code, 'UC8011')).length).toBe(1);
});
test('loadfile()() is flagged exactly once (not double-counted on the outer call)', async () => {
  const ds = await codesOf(handler("  loadfile('/x.uc')();"), 'UC8011');
  expect(ds.length).toBe(1);
});
test('loadfile with a DYNAMIC path gets the warning-level nudge', async () => {
  const ds = await codesOf(handler("  let m = loadfile(env.script)();"), 'UC8011');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(2); // warning — can't prove raw code, but a template closure is rarely intended
});

// ── template includes are the sanctioned mechanism ────────────────────────────
test('include of a .ut template is uhttpd-native → no UC8011 (the uspot pattern)', async () => {
  const ds = await codesOf(handler("  include('templates/error.ut', { env });"), 'UC8011');
  expect(ds.length).toBe(0);
});
test('include of a non-.uc file renders as template text → no UC8011', async () => {
  expect((await codesOf(handler("  include('/etc/hostname');"), 'UC8011')).length).toBe(0);
});
test('include with a dynamic path is not flagged (cannot prove raw code)', async () => {
  expect((await codesOf(handler("  include(env.tpl, { env });"), 'UC8011')).length).toBe(0);
});

// ── the UC8001 "guard with try/catch" advice is suppressed for loadfile in a handler ─
test('loadfile in a handler does NOT also get UC8001 (contradictory try/catch advice)', async () => {
  const ds = await codesOf(handler("  let x = loadfile('/missing.uc')();"), 'UC8001');
  expect(ds.length).toBe(0);
});

// ── must stay clean ───────────────────────────────────────────────────────────
test('loadstring()() in a handler is safe → no UC8011', async () => {
  expect((await codesOf(handler("  let x = loadstring('return 1')();"), 'UC8011')).length).toBe(0);
});
test('a static import in a handler is safe → no UC8011', async () => {
  const code = "{%\nimport { x } from './dep.uc';\nglobal.handle_request = function(env) { return x; };\n%}\n";
  expect((await codesOf(code, 'UC8011')).length).toBe(0);
});
test('loadfile in a NON-handler template (no handle_request) is NOT flagged UC8011', async () => {
  const code = "{%\nlet x = loadfile('/x.uc')();\nprint(x);\n%}\n";
  expect((await codesOf(code, 'UC8011')).length).toBe(0);
});
test('loadfile in a plain script is NOT flagged UC8011', async () => {
  expect((await codesOf("let x = loadfile('/x.uc')();\n", 'UC8011')).length).toBe(0);
});
