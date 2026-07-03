// blocking-socketpair-recv-uc8010: socket.pair() returns a connected socketpair in
// BLOCKING mode by default (uc_socket_pair: SOCK_STREAM, no SOCK_NONBLOCK). recv()/
// recvmsg() on such a socket with no MSG_DONTWAIT blocks in recvfrom() until the PEER
// is written to — and both ends are local, so if nothing ever send()s on the other
// socket the program hangs silently forever (and buffered print() output never shows).
// UC8010 fires only when the socket PROVABLY comes from a blocking pair() and the file
// never send()s on a pair socket — otherwise it stays quiet (no false-positive magnet).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/blocking-recv-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const blockingRecv = async (code) => (await diags(code)).filter((d) => d.code === 'UC8010');

const HDR = "import { pair, SOCK_STREAM, SOCK_NONBLOCK, MSG_DONTWAIT } from 'socket';\n";

// ── must flag (silent hang) ──────────────────────────────────────────────────
test('recv() on a pair socket via two hops (sox[0] -> s0) is flagged', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nlet s0 = sox[0];\nlet rx = s0.recv(10);\n');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(2); // Warning
  expect(ds[0].message).toContain('blocking socketpair');
});
test('recv() on an inline index sox[0].recv() is flagged', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nlet rx = sox[0].recv(10);\n');
  expect(ds.length).toBe(1);
});
test('recv() directly on pair()[0].recv() is flagged', async () => {
  const ds = await blockingRecv(HDR + 'let rx = pair()[0].recv(10);\n');
  expect(ds.length).toBe(1);
});
test('recvmsg() on a pair socket is flagged too', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nlet rx = sox[1].recvmsg();\n');
  expect(ds.length).toBe(1);
});
test('namespace import socket.pair() is flagged', async () => {
  const ds = await blockingRecv("import * as socket from 'socket';\nlet sox = socket.pair();\nlet rx = sox[0].recv(10);\n");
  expect(ds.length).toBe(1);
});
test('the diagnostic anchors on the method name', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nlet rx = sox[0].recv(10);\n');
  // line 2 (0-based) is `let rx = sox[0].recv(10);`
  expect(ds[0].range.start.line).toBe(2);
});

test('recv() inside a nested if-block is flagged (post-pass, scope-exited symbols)', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nif (sox) {\n  let s0 = sox[0];\n  if (s0)\n    let rx = s0.recv(10);\n}\n');
  expect(ds.length).toBe(1);
});
test('a send() on ONE pair does not suppress a blocking recv on a DIFFERENT pair', async () => {
  const ds = await blockingRecv(HDR +
    'let a = pair();\na[1].send("x");\nlet ra = a[0].recv(10);\n' +   // suppressed (has send)
    'let b = pair();\nlet rb = b[0].recv(10);\n');                    // flagged (no send)
  expect(ds.length).toBe(1);
  expect(ds[0].range.start.line).toBe(5); // the `b[0].recv` line
});

// ── must stay clean (no hang / not provably a blocking pair) ──────────────────
test('pair(SOCK_STREAM | SOCK_NONBLOCK) is non-blocking → clean', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair(SOCK_STREAM | SOCK_NONBLOCK);\nlet rx = sox[0].recv(10);\n');
  expect(ds.length).toBe(0);
});
test('recv(len, MSG_DONTWAIT) is non-blocking → clean', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nlet rx = sox[0].recv(10, MSG_DONTWAIT);\n');
  expect(ds.length).toBe(0);
});
test('a send() on a pair socket in the file suppresses the warning (real IPC)', async () => {
  const ds = await blockingRecv(HDR + 'let sox = pair();\nsox[1].send("ping");\nlet rx = sox[0].recv(10);\n');
  expect(ds.length).toBe(0);
});
test('recv() on a non-pair socket (create) is NOT flagged', async () => {
  const ds = await blockingRecv("import { create, AF_INET, SOCK_STREAM } from 'socket';\nlet s = create(AF_INET, SOCK_STREAM);\nlet rx = s.recv(10);\n");
  expect(ds.length).toBe(0);
});
test('recv() on a socket from an unknown origin is NOT flagged', async () => {
  const ds = await blockingRecv('function get() { return null; }\nlet s = get();\nlet rx = s.recv(10);\n');
  expect(ds.length).toBe(0);
});
test('a user object with a recv() method is NOT flagged', async () => {
  const ds = await blockingRecv('let o = { recv: function(n) { return n; } };\nlet rx = o.recv(10);\n');
  expect(ds.length).toBe(0);
});
