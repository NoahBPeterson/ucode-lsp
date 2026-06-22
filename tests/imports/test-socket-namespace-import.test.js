// auto-docs/03: `import * as socket from "socket"` was typed as the socket OBJECT (the handle
// returned by socket.create()) instead of the socket MODULE, because `socket` is the one name
// that is both a KnownModule and a KnownObjectType. So every module function (create, sockaddr,
// connect, listen, nameinfo, addrinfo, poll) and every module constant (AF_INET, SOCK_STREAM, …)
// false-errored "Method 'X' does not exist on socket", and completion offered the object's
// methods (connect/bind/recv/…) instead of the module's functions/constants.
//
// Fix: a namespace import is always a module namespace (never an object-handle export), marked
// importSpecifier === '*'. The typeChecker and completion both detect that and resolve module
// members, while a real socket OBJECT handle (`let s = socket.create(...)`) still uses object
// methods. Verified vs /usr/local/bin/ucode: socket.create / socket.AF_INET6 / socket.sockaddr
// all resolve.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/sock-ns-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const msgs = async (code) => (await server.getDiagnostics(code, uri()) || []).map((x) => `${x.severity} ${x.message}`);
const comp = async (code, line, col) => {
  const c = await server.getCompletions(code, uri(), line, col) || [];
  return (c.items || c || []).map((i) => i.label);
};
async function hover(code, marker, id) {
  const i = code.lastIndexOf(marker) + marker.indexOf(id);
  const pre = code.slice(0, i);
  const line = (pre.match(/\n/g) || []).length;
  const c = i - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, uri(), line, c);
  const v = h && h.contents && (h.contents.value || h.contents);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}

const NS = 'import * as socket from "socket";\n';

// ── No false "does not exist on socket" on module functions ──────────────────
const MODULE_FNS = ['create', 'connect', 'listen', 'sockaddr', 'nameinfo', 'addrinfo', 'poll', 'error'];
for (const fn of MODULE_FNS) {
  test(`module function socket.${fn} raises no "does not exist on socket"`, async () => {
    const e = await errs(`${NS}let x = socket.${fn};\nprint(x);\n`);
    expect(e.some((m) => /does not exist on socket/.test(m))).toBe(false);
  });
}

// ── No false error on module constants ───────────────────────────────────────
const MODULE_CONSTS = ['AF_INET', 'AF_INET6', 'SOCK_STREAM', 'SOCK_DGRAM', 'SOCK_NONBLOCK', 'SOL_SOCKET', 'POLLIN'];
for (const k of MODULE_CONSTS) {
  test(`module constant socket.${k} raises no error`, async () => {
    const e = await errs(`${NS}let x = socket.${k};\nprint(x);\n`);
    expect(e.some((m) => /does not exist on socket|not available on the socket/.test(m))).toBe(false);
  });
}

// ── The full real-corpus repro line is clean ─────────────────────────────────
test('the real repro (create + constants + sockaddr) produces no errors', async () => {
  const code = `${NS}let sock = socket.create(socket.AF_INET6, socket.SOCK_STREAM | socket.SOCK_NONBLOCK);\nlet addr = socket.sockaddr({ family: socket.AF_INET6 });\nprint(sock, addr);\n`;
  expect(await errs(code)).toEqual([]);
});

// ── Member types resolve ─────────────────────────────────────────────────────
test('socket.create is typed as a function (let f = socket.create; f hovers the create signature)', async () => {
  const code = `${NS}let f = socket.create;\n`;
  const t = await hover(code, 'let f', 'f');
  // resolves to the create() function — hover shows its signature, not "unknown"/an object
  expect(t).toMatch(/create\(|socket \| null|function/);
  expect(t).not.toMatch(/unknown/);
});
test('socket.AF_INET is typed as an integer (let n = socket.AF_INET; n hovers integer)', async () => {
  const code = `${NS}let n = socket.AF_INET;\n`;
  const t = await hover(code, 'let n', 'n');
  expect(t).toMatch(/integer|number/i);
});

// ── Hover on the namespace itself says module (was already correct) ───────────
test('hover on the `socket` namespace says module, not object', async () => {
  const code = `${NS}socket.create(0,0);\n`;
  const t = await hover(code, 'socket.create', 'socket');
  expect(t).toMatch(/module/);
});

// ── Completion after `socket.` offers module functions + constants ───────────
test('completion after `socket.` offers module functions (create, sockaddr)', async () => {
  const labels = await comp(`${NS}socket.\n`, 1, 7);
  expect(labels).toContain('create');
  expect(labels).toContain('sockaddr');
});
test('completion after `socket.` offers module constants (AF_INET, SOCK_STREAM)', async () => {
  const labels = await comp(`${NS}socket.\n`, 1, 7);
  expect(labels).toContain('AF_INET');
  expect(labels).toContain('SOCK_STREAM');
});
test('completion after `socket.` includes the connect/listen module functions', async () => {
  const labels = await comp(`${NS}socket.\n`, 1, 7);
  expect(labels).toContain('connect');
  expect(labels).toContain('listen');
});

// ── A real socket OBJECT handle still uses object methods (regression) ────────
test('a socket OBJECT handle (let s = socket.create()) completes object methods, not create', async () => {
  const code = `${NS}let s = socket.create(socket.AF_INET, socket.SOCK_STREAM);\ns.\n`;
  const labels = await comp(code, 2, 2);
  expect(labels).toContain('connect'); // object method
  expect(labels).toContain('recv');    // object-only method
  expect(labels).not.toContain('create');   // module fn must NOT appear on a handle
  expect(labels).not.toContain('sockaddr'); // module fn must NOT appear on a handle
});
test('a socket OBJECT handle method call (s.recv()) raises no error', async () => {
  const code = `${NS}let s = socket.create(socket.AF_INET, socket.SOCK_STREAM);\ns.recv(10);\n`;
  expect(await errs(code)).toEqual([]);
});
test('a bogus method on a socket OBJECT handle is still flagged (soundness)', async () => {
  const code = `${NS}let s = socket.create(socket.AF_INET, socket.SOCK_STREAM);\ns.no_such_method();\n`;
  expect((await errs(code)).some((m) => /does not exist on socket/.test(m))).toBe(true);
});

// ── Soundness: a bogus module member is still flagged ────────────────────────
test('a bogus socket module function call is still flagged', async () => {
  const all = await msgs(`${NS}socket.totally_not_a_fn();\n`);
  expect(all.some((m) => /not available on the socket module|does not exist/.test(m))).toBe(true);
});

// ── Regression: `import * as fs` (module whose name is NOT an object type) ────
test('regression: `import * as fs` still resolves module functions (fs.open)', async () => {
  const code = 'import * as fs from "fs";\nlet f = fs.open("/tmp/x");\nprint(f);\n';
  expect((await errs(code)).some((m) => /does not exist|not available/.test(m))).toBe(false);
});
test('regression: completion after `fs.` still offers module functions (open, readfile)', async () => {
  const labels = await comp('import * as fs from "fs";\nfs.\n', 1, 3);
  expect(labels).toContain('open');
  expect(labels).toContain('readfile');
});

// ── Regression: named import of an fs object handle (stdin → fs.file) ─────────
test('regression: named handle import `import { stdin } from "fs"` still completes fs.file methods', async () => {
  const labels = await comp('import { stdin } from "fs";\nstdin.\n', 1, 6);
  expect(labels).toContain('read'); // fs.file method, proves object-handle path intact
});
