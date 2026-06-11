// auto-docs/07: dot/method access on an `object | array` union false-errored "Property X does
// not exist on array type". Verified vs /usr/local/bin/ucode: dot-access on an array returns
// null (no throw), and the object member has the property — so `(c ? {a:5} : [1]).a` is safe
// and prints 5. The union member-access check now succeeds when an object member is present
// (it supports the access; the array member is null-safe). The over-broad return type of
// nl80211.request()/rtnl.request() (object|array|boolean|null) is intentionally NOT narrowed:
// a NLM_F_DUMP request genuinely returns an array, so the union is correct — the access fix is
// what's needed, not a lie about the return type.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/union-oa-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const arrayErr = async (code) => (await errs(code)).some((m) => /does not exist on array type/.test(m));

// ── object | array union: dot / method access is valid ───────────────────────
test('dot-access on an object|array union is not flagged', async () => {
  expect(await arrayErr('function f(c) { let x = c ? {a:1} : [1]; return x.a; }\n')).toBe(false);
});
test('method call on an object|array union is not flagged', async () => {
  expect(await arrayErr('function g(c) { let x = c ? {f:()=>1} : [1]; return x.f(); }\n')).toBe(false);
});
test('the object|array union produces NO errors at all', async () => {
  expect(await errs('function f(c) { let x = c ? {a:1} : [1]; return x.a; }\n')).toEqual([]);
});

// ── Real corpus: nl80211.request() / rtnl.request() (object|array|boolean|null) ──
test('nl80211.request().field is clean (the corpus repro)', async () => {
  const code = 'import * as nl80211 from "nl80211";\n' +
    'function p(i) {\n' +
    '  let data = nl80211.request(nl80211.const.NL80211_CMD_GET_WIPHY, 0, { wiphy: i });\n' +
    '  return !data.software_iftypes.monitor;\n}\n';
  expect((await errs(code)).some((m) => /does not exist on array type|does not exist on boolean/.test(m))).toBe(false);
});
test('rtnl.request().field is clean', async () => {
  const code = 'import * as rtnl from "rtnl";\n' +
    'function p() {\n  let d = rtnl.request(rtnl.const.RTM_GETLINK, 0, {});\n  return d.ifname;\n}\n';
  expect(await arrayErr(code)).toBe(false);
});

// ── Soundness preserved: pure array + array|null still error ─────────────────
test('a PURE array still errors on dot access (arrays have no named members — by design)', async () => {
  expect(await arrayErr('let x = [1,2];\nx.foo;\n')).toBe(true);
});
test('an array|null union still errors on dot access (no object member to support it)', async () => {
  expect(await arrayErr('let x = sort(keys({a:1}));\nx.foo;\n')).toBe(true);
});
test('a plain array method call (arr.push) still errors', async () => {
  expect(await arrayErr('let x = [1,2];\nx.push(3);\n')).toBe(true);
});
