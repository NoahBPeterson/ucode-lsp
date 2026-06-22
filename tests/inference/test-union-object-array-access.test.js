// auto-docs/07: member access on an `object | array` union.
//
// Evolution: 0.6.211 made it clean (object member supports the access). 0.6.212 reconsidered —
// accessing a property on the *array* branch is meaningless (returns null, never a real value),
// so even though it's null-safe it's a latent bug. It's "possibly array", exactly parallel to
// "possibly null": a WARNING (no hard error — the object branch is valid), escalating to ERROR
// under `'use strict'`. A pure array / `array | null` (no object member) stays a hard error.
//
// nl80211.request()/rtnl.request() are genuinely irreducible here: object-vs-array is a runtime
// reply-count property (verified in nl80211.c — single reply → object, multiple → array,
// GET_WIPHY merges → object), NOT derivable from the arguments. So they warn (sound), rather
// than being narrowed or exempted.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/union-oa-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri()) || []);
const hardArrayErr = async (code) => (await diags(code)).some((x) => x.severity === 1 && /does not exist on array type/.test(x.message));
const possiblyArrayWarn = async (code) => (await diags(code)).some((x) => x.severity === 2 && /may be an array/.test(x.message));
const possiblyArrayErr = async (code) => (await diags(code)).some((x) => x.severity === 1 && /may be an array/.test(x.message));

// ── object | array union: possibly-array WARNING (not a hard error) ──────────
test('dot-access on an object|array union warns (possibly array), not a hard error', async () => {
  const code = 'function f(c) { let x = c ? {a:1} : [1]; return x.a; }\n';
  expect(await possiblyArrayWarn(code)).toBe(true);
  expect(await hardArrayErr(code)).toBe(false);
});
test('method call on an object|array union warns', async () => {
  expect(await possiblyArrayWarn('function g(c) { let x = c ? {f:()=>1} : [1]; return x.f(); }\n')).toBe(true);
});
test("under 'use strict', object|array member access escalates to an error", async () => {
  const code = "'use strict';\nfunction f(c) { let x = c ? {a:1} : [1]; return x.a; }\n";
  expect(await possiblyArrayErr(code)).toBe(true);
  expect(await possiblyArrayWarn(code)).toBe(false);
});

// ── nl80211 / rtnl request() (object|array|boolean|null) — warns (irreducible) ─
test('nl80211.request().field warns (possibly array) — sound, not exempted', async () => {
  const code = 'import * as nl80211 from "nl80211";\n' +
    'function p(i) {\n  let data = nl80211.request(nl80211.const.NL80211_CMD_GET_WIPHY, 0, { wiphy: i });\n  return data.software_iftypes;\n}\n';
  expect(await possiblyArrayWarn(code)).toBe(true);
  expect(await hardArrayErr(code)).toBe(false); // not a hard "array type" error
});
test('rtnl.request().field warns (possibly array)', async () => {
  const code = 'import * as rtnl from "rtnl";\n' +
    'function p() {\n  let d = rtnl.request(rtnl.const.RTM_GETLINK, 0, {});\n  return d.ifname;\n}\n';
  expect(await possiblyArrayWarn(code)).toBe(true);
});

// ── Soundness preserved: pure array + array|null still HARD error ────────────
test('a PURE array still hard-errors on dot access (no object member)', async () => {
  expect(await hardArrayErr('let x = [1,2];\nx.foo;\n')).toBe(true);
  expect(await possiblyArrayWarn('let x = [1,2];\nx.foo;\n')).toBe(false);
});
test('an array|null union still hard-errors on dot access (no object member)', async () => {
  expect(await hardArrayErr('let x = sort(keys({a:1}));\nx.foo;\n')).toBe(true);
});
test('a plain array method call (arr.push) still hard-errors', async () => {
  expect(await hardArrayErr('let x = [1,2];\nx.push(3);\n')).toBe(true);
});

// ── A plain object is clean (no warning) ─────────────────────────────────────
test('a plain (non-union) object is not flagged', async () => {
  expect(await possiblyArrayWarn('let o = { a: 1 };\no.a;\n')).toBe(false);
  expect(await hardArrayErr('let o = { a: 1 };\no.a;\n')).toBe(false);
});
