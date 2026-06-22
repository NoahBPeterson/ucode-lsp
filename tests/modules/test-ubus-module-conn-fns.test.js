// auto-docs/04: the `ubus` module namespace was missing its connection functions. ucode/lib/
// ubus.c `uc_module_init()` registers BOTH global_fns (error/connect/open_channel/guard) AND
// conn_fns (list/call/defer/publish/remove/listener/subscriber/event/disconnect) into the
// module scope, so all are valid members of `ubus`. The LSP modeled only global_fns, so
// `ubus.call(...)`/`ubus.publish(...)`/`ubus.listener(...)` raised false UC3001 "not available
// on the ubus module" (29 occurrences in the OpenWrt corpus: wireless.uc, wdev.uc, …).
//
// Fix: the module's function map is the union of global_fns + conn_fns (the conn_fns already
// existed as the ubus.connection object's methods — same signatures reused). Soundness kept:
// a bogus member is still flagged, and a real connection object still resolves its methods.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/ubus-conn-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const msgs = async (code) => (await server.getDiagnostics(code, uri()) || []).map((x) => x.message);
const comp = async (code, line, col) => {
  const c = await server.getCompletions(code, uri(), line, col) || [];
  return (c.items || c || []).map((i) => i.label);
};

const NS = 'import * as ubus from "ubus";\n';

// ── conn_fns are valid members of the ubus namespace ─────────────────────────
const CONN_FNS = ['list', 'call', 'defer', 'publish', 'remove', 'listener', 'subscriber', 'event', 'disconnect'];
for (const fn of CONN_FNS) {
  test(`conn_fn ubus.${fn} raises no "not available on the ubus module"`, async () => {
    const e = await errs(`${NS}ubus.${fn}();\n`);
    expect(e.some((m) => /not available on the ubus module|does not exist on/.test(m))).toBe(false);
  });
}

// ── global_fns still resolve (regression) ────────────────────────────────────
const GLOBAL_FNS = ['error', 'connect', 'open_channel', 'guard'];
for (const fn of GLOBAL_FNS) {
  test(`global_fn ubus.${fn} still resolves (regression)`, async () => {
    const e = await errs(`${NS}ubus.${fn}();\n`);
    expect(e.some((m) => /not available on the ubus module|does not exist on/.test(m))).toBe(false);
  });
}

// ── The real-corpus repro is clean ───────────────────────────────────────────
test('the real repro (call/publish/listener on the namespace) produces no errors', async () => {
  const code = `${NS}let r = ubus.call("system", "info");\n` +
    'let p = ubus.publish("network.wireless", {});\n' +
    'let l = ubus.listener("ubus.object.add", (e, m) => {});\n' +
    'print(r, p, l);\n';
  expect(await errs(code)).toEqual([]);
});

// ── conn_fns resolve to FUNCTION (callable) on the namespace ──────────────────
test('ubus.call is callable (no "not a function") and its result is usable', async () => {
  const e = await errs(`${NS}let r = ubus.call("system", "info");\nprint(r);\n`);
  expect(e).toEqual([]);
});

// ── Completion offers conn_fns AND global_fns ────────────────────────────────
test('completion after `ubus.` offers the connection functions', async () => {
  const labels = await comp(`${NS}ubus.\n`, 1, 5);
  for (const fn of ['call', 'publish', 'listener', 'subscriber', 'list', 'defer', 'remove', 'event', 'disconnect']) {
    expect(labels).toContain(fn);
  }
});
test('completion after `ubus.` still offers the global functions', async () => {
  const labels = await comp(`${NS}ubus.\n`, 1, 5);
  for (const fn of ['connect', 'open_channel', 'guard', 'error']) {
    expect(labels).toContain(fn);
  }
});

// ── Soundness: a genuinely bogus member is still flagged ──────────────────────
test('a bogus ubus module member is still flagged', async () => {
  const m = await msgs(`${NS}ubus.totally_not_a_fn();\n`);
  expect(m.some((x) => /not available on the ubus module|does not exist/.test(x))).toBe(true);
});

// ── Named import of a conn_fn works too ──────────────────────────────────────
test('named import `import { call, publish } from "ubus"` is valid', async () => {
  const e = await errs('import { call, publish, listener } from "ubus";\nprint(call, publish, listener);\n');
  expect(e.some((m) => /not exported|No export|does not export|Cannot/.test(m))).toBe(false);
});

// ── Regression: a real ubus.connection object still resolves its methods ──────
test('regression: a ubus.connect() handle still resolves connection methods (conn.call)', async () => {
  const code = `${NS}let conn = ubus.connect();\nconn.call("system", "info");\nconn.disconnect();\n`;
  expect(await errs(code)).toEqual([]);
});
test('regression: a bogus method on a ubus.connection handle is still flagged', async () => {
  const code = `${NS}let conn = ubus.connect();\nconn.no_such_method();\n`;
  expect((await errs(code)).some((m) => /does not exist on ubus\.connection|does not exist/.test(m))).toBe(true);
});
