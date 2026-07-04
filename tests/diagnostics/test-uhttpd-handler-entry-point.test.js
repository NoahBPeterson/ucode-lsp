// A uhttpd ucode handler registers its entry point as `global.handle_request = <fn>`; the
// host (uhttpd/ucode.c UH_UCODE_CB) looks it up in the VM scope and calls it per request, so
// it is NOT local dead code even when nothing in the file references it. UC1006 "declared but
// never used" must not fire on that binding. The suppression is targeted: it applies only to
// known host entry-point callbacks assigned as `global.<name>`, not to locals or other globals.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/uhttpd-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const unused = async (code, name) =>
  (await diags(code)).filter((d) => d.code === 'UC1006' && d.message.includes(`'${name}'`));

// ── must NOT flag the entry point ────────────────────────────────────────────
test('global.handle_request = fn is not flagged UC1006 (plain script form)', async () => {
  const ds = await unused("global.handle_request = function(env) { return env; };\n", 'handle_request');
  expect(ds.length).toBe(0);
});
test('global.handle_request = fn is not flagged UC1006 (template handler form)', async () => {
  const ds = await unused("{%\nglobal.handle_request = function(env) { return env; };\n%}\n", 'handle_request');
  expect(ds.length).toBe(0);
});

// ── must still flag genuinely-unused things (targeted, not blanket) ───────────
test('an unused local `let handle_request` still flags (wrong form — not a global binding)', async () => {
  const ds = await unused("let handle_request = function(env) { return env; };\n", 'handle_request');
  expect(ds.length).toBe(1);
});
test('an unrelated unused global function binding still flags UC1006', async () => {
  // Same binding shape as handle_request (global.<name> = fn) but not a host callback.
  const ds = await unused("global.some_helper = function() { return 1; };\n", 'some_helper');
  expect(ds.length).toBe(1);
});
