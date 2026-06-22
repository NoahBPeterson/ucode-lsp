// #24 — nl80211/rtnl constants are NOT top-level exports: they live under the nested `const`
// object (verified vs lib/{nl80211,rtnl}.c: ADD_CONST targets a separate object attached as
// scope.const; only error/request/[waitfor]/listener/const are top-level). So a bare constant
// must not be offered as an `import { }` name, and importing one must be flagged. (socket's
// constants ARE top-level — oracle-confirmed `import { AF_INET } from 'socket'` → 2.)
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const errs = async (code) => ((await s.getDiagnostics(code, `/tmp/n24-${n++}.uc`)) || []).filter((d) => d.severity === 1);
const labels = (i) => (i?.items ?? i ?? []).map((x) => x.label);

// ── importing a bare constant is flagged (was: no error) ──
test('import { NLM_F_ACK } from nl80211 is flagged UC3005', async () => {
  const e = await errs("import { NLM_F_ACK } from 'nl80211';\n");
  expect(e.map((d) => d.code)).toContain('UC3005');
});
test('import { RTM_NEWLINK } from rtnl is flagged UC3005', async () => {
  expect((await errs("import { RTM_NEWLINK } from 'rtnl';\n")).map((d) => d.code)).toContain('UC3005');
});

// ── the real top-level exports import cleanly ──
test('importing the actual nl80211 functions is clean', async () => {
  expect(await errs("import { request, waitfor, listener, error } from 'nl80211';\n")).toEqual([]);
});
test('importing the actual rtnl functions is clean', async () => {
  expect(await errs("import { request, listener, error } from 'rtnl';\n")).toEqual([]);
});

// ── completion no longer offers the constants as import names ──
test('import { } from nl80211 completion offers functions, not constants', async () => {
  const c = labels(await s.getCompletions("import {  } from 'nl80211';\n", `/tmp/n24c-${n++}.uc`, 0, 8));
  expect(c).toContain('request');
  expect(c.filter((l) => l.startsWith('NLM_') || l.startsWith('NL80211_')).length).toBe(0);
});

// ── socket constants ARE top-level — must stay importable (no regression) ──
test('socket constants remain importable (top-level in lib/socket.c)', async () => {
  expect(await errs("import { AF_INET } from 'socket';\n")).toEqual([]);
});

// ── #23 not regressed: nl80211.const. still lists the constants ──
test('nl80211.const. still completes the constants', async () => {
  const c = labels(await s.getCompletions("import * as nl from 'nl80211';\nnl.const.\n", `/tmp/n24d-${n++}.uc`, 1, 9));
  expect(c).toContain('NL80211_CMD_GET_WIPHY');
});
