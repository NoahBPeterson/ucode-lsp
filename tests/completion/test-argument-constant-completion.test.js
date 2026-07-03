// Argument-position constant completion (+ signature help for module functions): inside a
// call to a module function/method whose active parameter accepts a constant family, the
// empty/partial arg slot offers exactly those constants (with auto-import), and module
// functions get signature help. Driven by per-parameter `constantPrefixes` metadata.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function items(code, line, character) {
  const r = await server.getCompletions(code, '/tmp/argc.uc', line, character);
  return Array.isArray(r) ? r : (r?.items || []);
}
const labelsAt = async (c, l, ch) => (await items(c, l, ch)).map((i) => i.label);
const NAMED = "import { pair, create, MSG_DONTWAIT, AF_INET } from 'socket';\n";
const NS = "import * as socket from 'socket';\n";
const has = (arr, p) => arr.filter((x) => x.startsWith(p)).length;

// ── the constants that belong in each slot ───────────────────────────────────
test('empty pair() offers SOCK_ constants', async () => {
  const s = 'let z = pair(';
  const l = await labelsAt(NAMED + s + ');\n', 1, s.length);
  expect(l).toContain('SOCK_DGRAM');
  expect(has(l, 'SOCK_')).toBeGreaterThan(2);
  expect(l).not.toContain('MSG_PEEK'); // wrong family (unimported) must NOT appear
});
test('create() arg 0 offers AF_, arg 1 offers SOCK_', async () => {
  const s0 = 'let s = create(';
  const l0 = await labelsAt(NAMED + s0 + ');\n', 1, s0.length);
  expect(has(l0, 'AF_')).toBeGreaterThan(2);
  expect(has(l0, 'SOCK_')).toBe(0);
  const s1 = 'let s = create(AF_INET, ';
  const l1 = await labelsAt(NAMED + s1 + ');\n', 1, s1.length);
  expect(has(l1, 'SOCK_')).toBeGreaterThan(2);
});
test('recv flags slot offers MSG_ — indexed receiver sox[0].recv', async () => {
  const code = NAMED + 'let sox = pair();\nlet r = sox[0].recv(10, );\n';
  const s = 'let r = sox[0].recv(10, ';
  const l = await labelsAt(code, 2, s.length);
  expect(l).toContain('MSG_DONTWAIT');
});
test('recv flags slot offers MSG_ — simple-label receiver sox_0.recv', async () => {
  const code = NAMED + 'let sox = pair();\nlet sox_0 = sox[0];\nlet r = sox_0.recv(10, );\n';
  const s = 'let r = sox_0.recv(10, ';
  const l = await labelsAt(code, 3, s.length);
  expect(l).toContain('MSG_DONTWAIT');
});

// ── auto-import shaping ───────────────────────────────────────────────────────
test('named-import file: bare constant + adds a socket import', async () => {
  const s = 'let z = create(';
  const it = (await items("import { create } from 'socket';\n" + s + ');\n', 1, s.length))
    .find((i) => i.label === 'AF_INET');
  expect(it.insertText).toBe('AF_INET');
  expect(it.additionalTextEdits[0].newText).toContain("import { AF_INET } from 'socket';");
});
test('namespace-import file: qualified socket.CONST, no import edit', async () => {
  const s = 'let z = socket.pair(';
  const it = (await items(NS + s + ');\n', 1, s.length)).find((i) => i.label === 'SOCK_DGRAM');
  expect(it.insertText).toBe('socket.SOCK_DGRAM');
  expect(it.additionalTextEdits).toBeUndefined();
});
test('already-imported constant: no duplicate import edit', async () => {
  const s = 'let z = create(AF_INET, ';
  const it = (await items(NAMED + s + ');\n', 1, s.length)).find((i) => i.label === 'SOCK_STREAM');
  // SOCK_STREAM is not in NAMED's import list → gets an import edit; AF_INET (imported) would not.
  const af = (await items(NAMED + 'let z = create(', 1, 'let z = create('.length)).find((i) => i.label === 'AF_INET');
  expect(af.additionalTextEdits).toBeUndefined();
});

// ── must NOT inject constants ─────────────────────────────────────────────────
test('a non-constant parameter slot (send data arg) injects no constants', async () => {
  // MSG_PEEK is NOT imported, so if it appears it can only be arg-injection.
  const code = NAMED + 'let sox = pair();\nlet n = sox[0].send();\n';
  const s = 'let n = sox[0].send(';
  const l = await labelsAt(code, 2, s.length);
  expect(l).not.toContain('MSG_PEEK'); // arg 0 is `data`, not flags
});
test('a plain user function call injects no socket constants', async () => {
  // No socket import at all → an injected family member like SOCK_DGRAM could only come
  // from arg-injection.
  const code = 'function foo(a) { return a; }\nfoo();\n';
  const s = 'foo(';
  const l = await labelsAt(code, 1, s.length);
  expect(l).not.toContain('SOCK_DGRAM');
  expect(l).not.toContain('AF_INET');
});

// ── signature help for module functions ──────────────────────────────────────
test('signature help fires for a named-import module function pair(', async () => {
  const s = 'let z = pair(';
  const sh = await server.getSignatureHelp(NAMED + s + ');\n', '/tmp/sh.uc', 1, s.length);
  expect(sh?.signatures?.[0]?.label).toBe('pair(type?)'); // single `type` param (ucode reality)
});
