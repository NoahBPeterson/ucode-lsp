// Batch A — nl80211 / rtnl type-table fixes:
//  - #39 nl80211.listener has a request() method (ucode/lib/nl80211.c listener_fns).
//  - #40 nl80211 constants back in sync with ADD_CONST — the 23 missing constants
//        (NL80211_CMD_ABORT_SCAN, NL80211_SCAN_FLAG_*, NL80211_BSS_STATUS_*, …) resolve
//        via the `const` namespace (constants are NOT top-level imports in real ucode).
//  - #41 rtnl constants regenerated from ADD_CONST — real-but-missing names (FR_ACT_GOTO,
//        IFA_F_PERMANENT, GRE_*, …) resolve; phantom names (RTA_DST, RTPROT_*, …) are gone.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const errs = async (code) => ((await s.getDiagnostics(code, `/tmp/ba-nr-${n++}.uc`)) || []).filter((d) => d.severity === 1);

// ── #39: listener.request() exists ──
test('nl80211.listener.request() is a known method (no UC5004)', async () => {
  const code = "import * as n from 'nl80211';\nlet l = n.listener(() => {}, [1]);\nif (l) l.request(1, 2, {});\n";
  const e = await errs(code);
  expect(e.map((d) => d.code)).not.toContain('UC5004');
});

// ── #40: new nl80211 constants resolve via const namespace ──
test('newly-added nl80211 constants resolve under the const namespace', async () => {
  const code = "import { \"const\" as nlc } from 'nl80211';\n"
    + "let a = nlc.NL80211_CMD_ABORT_SCAN;\n"
    + "let b = nlc.NL80211_SCAN_FLAG_FLUSH;\n"
    + "let c = nlc.NL80211_BSS_STATUS_ASSOCIATED;\n"
    + "let d = nlc.NL80211_BSS_USE_FOR_NORMAL;\n"
    + "print(a, b, c, d);\n";
  expect(await errs(code)).toEqual([]);
});
test('nl80211 constants remain non-top-level exports (still UC3005 as bare import)', async () => {
  // constants live under `const`, not top-level — importing one bare stays flagged.
  const e = await errs("import { NL80211_CMD_ABORT_SCAN } from 'nl80211';\n");
  expect(e.map((d) => d.code)).toContain('UC3005');
});

// ── #41: rtnl constants — real names resolve, phantoms are gone ──
test('rtnl real-but-previously-missing constants resolve via const namespace', async () => {
  const code = "import { \"const\" as rtc } from 'rtnl';\n"
    + "let a = rtc.FR_ACT_GOTO;\n"
    + "let b = rtc.IFA_F_PERMANENT;\n"
    + "let c = rtc.GRE_CSUM;\n"
    + "let d = rtc.FIB_RULE_INVERT;\n"
    + "let e = rtc.NLM_F_ACK;\n"
    + "print(a, b, c, d, e);\n";
  expect(await errs(code)).toEqual([]);
});
test('rtnl phantom constants (never registered by ADD_CONST) are now rejected', async () => {
  // RTA_DST / RTPROT_KERNEL were phantom entries not present in ucode/lib/rtnl.c.
  const code = "import { \"const\" as rtc } from 'rtnl';\nlet x = rtc.RTA_DST;\nlet y = rtc.RTPROT_KERNEL;\nprint(x, y);\n";
  const codes = (await errs(code)).map((d) => d.code);
  expect(codes).toContain('UC5003');
});
