// Ticket 08 — disable-comment UX. New directive forms and semantics:
//   * `// ucode-lsp disable` REMOVES covered diagnostics (does not demote severity)
//   * `// ucode-lsp disable-next-line` suppresses the following line
//   * `// ucode-lsp disable UC####` limits suppression to the listed rule codes
//   * a bare defensive disable that matches nothing is NOT flagged; a stale
//     code-targeted disable that matches nothing IS flagged.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = (code, name) => server.getDiagnostics(code, `/tmp/t08-${name}-${Date.now()}.uc`);

test('bare disable removes every diagnostic on the line', async () => {
  const d = await diags('let y = undefined_zzz; // ucode-lsp disable', 'bare');
  expect(d.filter(x => x.range.start.line === 0).length).toBe(0);
});

test('disable-next-line suppresses the following line with no spurious self-flag', async () => {
  const d = await diags('// ucode-lsp disable-next-line\nlet y = undefined_zzz;', 'nextline');
  expect(d.filter(x => x.range.start.line === 1).length).toBe(0); // target line clean
  expect(d.some(x => x.message.includes('No diagnostic disabled'))).toBe(false); // no self-flag on line 0
});

test('disable UC#### only suppresses the listed code', async () => {
  // undefined_zzz is UC1001; y is unused => UC1006. Only UC1001 disabled.
  const d = await diags('let y = undefined_zzz; // ucode-lsp disable UC1001', 'codeonly');
  const line0 = d.filter(x => x.range.start.line === 0);
  expect(line0.some(x => x.code === 'UC1001')).toBe(false); // removed
  expect(line0.some(x => x.code === 'UC1006')).toBe(true);  // survives
});

test('bare defensive disable that matches nothing is NOT flagged', async () => {
  const d = await diags('let mocklib = global.mocklib; // ucode-lsp disable\nprint(mocklib);', 'defensive');
  expect(d.some(x => x.message.includes('No diagnostic disabled'))).toBe(false);
});

test('stale code-targeted disable that matches nothing IS flagged', async () => {
  const d = await diags('let y = undefined_zzz; // ucode-lsp disable UC9999', 'stale');
  const unnecessary = d.filter(x => x.message.includes('No diagnostic disabled'));
  expect(unnecessary.length).toBe(1);
  // UC9999 matched nothing, so the real UC1001/UC1006 diagnostics survive.
  expect(d.some(x => x.code === 'UC1001')).toBe(true);
});
