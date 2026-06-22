// A spread argument to printf/sprintf (`sprintf(fmt, ...mac)`) expands to an unknown
// number of values at runtime, so the format specifier-count check (UC2006) must not
// fire — and a genuine count mismatch with no spread must still be reported.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function uc2006(content, tag) {
  const d = await server.getDiagnostics(content, `/tmp/pfs-${tag}.uc`);
  return (d || []).find((x) => x.code === 'UC2006') || null;
}

test('sprintf with a spread argument does not flag a count mismatch', async () => {
  const c = `function f(mac) {\n    return sprintf("%02x:%02x:%02x:%02x:%02x:%02x", ...mac);\n}\n`;
  expect(await uc2006(c, 'sprintf-spread')).toBeNull();
});

test('printf with a spread argument does not flag a count mismatch', async () => {
  const c = `function f(mac) {\n    printf("%02x:%02x", ...mac);\n}\n`;
  expect(await uc2006(c, 'printf-spread')).toBeNull();
});

test('fixed args followed by a spread are not flagged', async () => {
  const c = `function f(a, rest) {\n    return sprintf("%s %d %d %d", a, ...rest);\n}\n`;
  expect(await uc2006(c, 'mixed-spread')).toBeNull();
});

test('a genuine count mismatch (no spread) is still reported', async () => {
  const c = `function f() {\n    return sprintf("%s %s %s", "a");\n}\n`;
  const d = await uc2006(c, 'real-mismatch');
  expect(d).not.toBeNull();
  expect(d.message).toContain('3 specifiers but only 1');
});
