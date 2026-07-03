// Regression: namespace-member completion must survive a PARTIAL property name being typed.
// detectMemberCompletionContext only recognized `socket.|` (cursor right after the dot); once
// the user typed `socket.AF`, the member context was lost and completion fell through to the
// global list (no AF_* → appears empty). VS Code re-requests completion every keystroke, so
// this is the common case, not an edge case.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function labelsAt(code, line, character) {
  const items = await server.getCompletions(code, '/tmp/pmc.uc', line, character);
  const arr = Array.isArray(items) ? items : (items?.items || []);
  return arr.map((i) => i.label);
}
const H = "import * as socket from 'socket';\n";

test('socket.AF| (partial) still offers socket constants', async () => {
  const s = 'let x = socket.AF';
  const labels = await labelsAt(H + s + ';\n', 1, s.length);
  expect(labels).toContain('AF_INET');
  expect(labels).toContain('AF_UNIX');
});

test('partial member completion works inside a call argument: pair(socket.SOCK|', async () => {
  const s = 'let x = pair(socket.SOCK';
  const labels = await labelsAt(H + s + ');\n', 1, s.length);
  expect(labels).toContain('SOCK_DGRAM');
  expect(labels).toContain('SOCK_NONBLOCK');
});

test('partial member completion works in the recv flags arg: recv(10, socket.MSG|', async () => {
  const s = 'let x = sox[0].recv(10, socket.MSG';
  const labels = await labelsAt(H + s + ');\n', 1, s.length);
  expect(labels).toContain('MSG_DONTWAIT');
});

test('cursor right after the dot (socket.|) still works (no regression)', async () => {
  const s = 'let x = socket.';
  const labels = await labelsAt(H + s + ';\n', 1, s.length);
  expect(labels).toContain('AF_INET');
  expect(labels).toContain('pair');
});

test('a partial member on a plain identifier does not leak the global list', async () => {
  // `notamodule.foo|` — no such symbol; must NOT return the global builtin list.
  const s = 'notamodule.foo';
  const labels = await labelsAt(s + ';\n', 0, s.length);
  expect(labels).not.toContain('print'); // a global builtin — would signal a leak
});
