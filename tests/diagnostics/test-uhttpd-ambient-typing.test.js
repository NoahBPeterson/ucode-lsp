// Phase E / FN-5: the `uhttpd` ambient is (1) TYPED as the uhttpd handle so member access
// resolves (uhttpd.recv() → string|null, uhttpd.docroot → string) and an unknown member
// (uhttpd.snd()) flags UC5004, and (2) gated to handler context — a non-handler file that
// references `uhttpd` gets UC1001 (it used to be an unconditional host global). Members are
// from the real uhttpd/ucode.c contract (send/sendc/recv/urldecode/urlencode + docroot string).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/uhambient-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const has = async (code, c) => (await diags(code)).some((d) => d.code === c);
const H = (body) => `{%\nglobal.handle_request = function(env) {\n${body}\n};\n%}\n`;
async function hover(code, line, char) {
  const h = await server.getHover(code, uri(), line, char);
  return h?.contents ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '') : '';
}

// ── typed members in a handler ────────────────────────────────────────────────
test('a valid uhttpd method (send) is clean', async () => {
  expect(await has(H("  uhttpd.send('hi');"), 'UC5004')).toBe(false);
});
test('every documented member resolves (send/sendc/recv/urldecode/urlencode/docroot)', async () => {
  const body = "  uhttpd.send('a'); uhttpd.sendc('b'); uhttpd.recv(1); uhttpd.urldecode('x'); uhttpd.urlencode('y'); let d = uhttpd.docroot;";
  expect(await has(H(body), 'UC5004')).toBe(false);
});
test('an unknown member (uhttpd.snd) is flagged UC5004', async () => {
  const ds = (await diags(H("  uhttpd.snd('hi');"))).filter((d) => d.code === 'UC5004');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain('uhttpd');
});
test('uhttpd.recv() types as string | null', async () => {
  const code = "{%\nglobal.handle_request = function(env) {\n  let rx = uhttpd.recv(10);\n};\n%}\n";
  expect(await hover(code, 2, 6)).toContain('string | null');
});
test('uhttpd.docroot types as string', async () => {
  const code = "{%\nglobal.handle_request = function(env) {\n  let dr = uhttpd.docroot;\n};\n%}\n";
  expect(await hover(code, 2, 6)).toContain('string');
});

// ── gated to handler context ──────────────────────────────────────────────────
test('a non-handler script referencing uhttpd gets UC1001 (no longer an unconditional global)', async () => {
  expect(await has("uhttpd.send('hi');\n", 'UC1001')).toBe(true);
});
test('a non-uhttpd template (no handle_request) referencing uhttpd also gets UC1001', async () => {
  // e.g. a firewall4-style template — uhttpd is specific to uhttpd handlers.
  expect(await has("{%\nlet x = uhttpd.docroot;\nprint(x);\n%}\n", 'UC1001')).toBe(true);
});
test('the uhttpd ambient itself is not flagged UC1006 unused in a handler that never uses it', async () => {
  const code = "{%\nglobal.handle_request = function(env) { return env; };\n%}\n";
  expect(await has(code, 'UC1006')).toBe(false);
});
