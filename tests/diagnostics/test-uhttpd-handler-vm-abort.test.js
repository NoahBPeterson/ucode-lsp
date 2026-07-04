// Phase C / FN-4 (UC8011): in a uhttpd handler, loadfile()/loadfile()()/include() abort the
// request VM uncatchably (empty response, no stderr; try/catch does not help) — verified in a
// real OpenWrt container. Static `import` and loadstring() are safe. The warning fires only in
// a detected handler (Phase B: `{%` template + global.handle_request), and it replaces UC8001's
// wrong "guard with try/catch" advice for loadfile in that context.
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

// ── must flag in a handler ────────────────────────────────────────────────────
test('loadfile()() in a handler is flagged UC8011', async () => {
  const ds = await codesOf(handler("  let x = loadfile('/x.uc')();"), 'UC8011');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(2); // Warning
  expect(ds[0].message).toContain('aborts the request VM');
});
test('include() in a handler is flagged UC8011', async () => {
  const ds = await codesOf(handler("  include('/etc/hostname');"), 'UC8011');
  expect(ds.length).toBe(1);
});
test('a top-level loadfile in the handler template is flagged', async () => {
  const code = "{%\nlet cfg = loadfile('/c.uc')();\nglobal.handle_request = function(env) { return cfg; };\n%}\n";
  expect((await codesOf(code, 'UC8011')).length).toBe(1);
});
test('loadfile()() is flagged exactly once (not double-counted on the outer call)', async () => {
  const ds = await codesOf(handler("  loadfile('/x.uc')();"), 'UC8011');
  expect(ds.length).toBe(1);
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
