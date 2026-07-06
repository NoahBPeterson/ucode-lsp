// The `hostapd` / `wpas` (wpa_supplicant) ambient globals — the hostapd & wpa_supplicant daemons
// bind a C-backed `hostapd` / `wpas` object into the VM scope before running their
// /usr/share/hostap/*.uc scripts. The single biggest FP source on the OpenWrt corpus (132 + 97
// UC1001). Seeded ONLY on a usage/path signal, version-gated (23.05+). See src/analysis/hostapdTypes.ts.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('hostapd/wpas ambient (typed, usage/path + version gated)', function () {
  this.timeout(20000);
  let s, ws;
  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hostapd-'));
    s = createLSPTestServer({
      workspaceRoot: ws,
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      configuration: { ucode: { targetVersion: '25.12' } },
    });
    await s.initialize();
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  const uri = (name) => `file://${path.join(ws, name)}`;
  const amb = (ds) => ds.filter((d) => (d.code === 'UC1001' || d.code === 'UC1002') && /\b(hostapd|wpas)\b/.test(d.message)).length;

  it('hostapd/wpas members resolve — no UC1001/UC1002 (the FP fix)', async () => {
    const u = uri('daemon.uc');
    s.openOrChangeDocument(u, "hostapd.printf(hostapd.MSG_INFO, 'hi');\nlet p = hostapd.getpid();\nhostapd.data.x = 1;\nwpas.add_iface({ iface: 'wlan0', config: '/e' });\n");
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    assert.strictEqual(amb(ds), 0, 'hostapd/wpas and their members should resolve');
  });

  it('the globals are OPEN: a runtime-extended member (hostapd.ubus) is not UC5004', async () => {
    // The scripts extend the globals in ucode (`hostapd.ubus = …`), so unknown members resolve to
    // `unknown`, not error.
    const u = uri('open.uc');
    s.openOrChangeDocument(u, "hostapd.printf('x');\nhostapd.ubus = 1;\nlet z = hostapd.frobnicate();\n");
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    assert.strictEqual(ds.filter((x) => x.code === 'UC5004').length, 0, 'extended global members must not error');
    assert.strictEqual(amb(ds), 0);
  });

  it('a non-hostapd script referencing bare `hostapd` still gets UC1001', async () => {
    const u = uri('random.uc');
    s.openOrChangeDocument(u, "print(hostapd);\n");
    const ds = await s.waitForDiagnostics(u, (d) => amb(d) >= 1, 8000);
    assert.ok(amb(ds) >= 1, 'hostapd is not injected into an ordinary script');
  });

  it('a local `let wpas` is NOT treated as the ambient (no over-injection)', async () => {
    const u = uri('local.uc');
    s.openOrChangeDocument(u, "let wpas = { foo: () => {} };\nwpas.foo();\nprint(hostapd);\n");
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    // wpas is the user's own local (fine); hostapd is still undefined here.
    assert.ok(ds.filter((d) => (d.code === 'UC1001' || d.code === 'UC1002') && /\bhostapd\b/.test(d.message)).length >= 1);
  });

  it('a /usr/share/hostap/ path resolves hostapd even with no member access', async () => {
    const u = uri(path.join('usr', 'share', 'hostap', 'hostapd.uc'));
    s.openOrChangeDocument(u, "let g = hostapd;\n");
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    assert.strictEqual(amb(ds), 0, 'path-based detection should declare hostapd');
  });

  it('below the 23.05 floor: hostapd usage is UC6005, not a bare UC1001 cascade', async () => {
    const u = uri('old.uc');
    s.notifyConfigChange({ targetVersion: '22.03' });
    s.openOrChangeDocument(u, "hostapd.printf('x');\nlet p = hostapd.getpid();\n");
    const ds = await s.waitForDiagnostics(u, (d) => d.some((x) => x.code === 'UC6005'), 8000);
    assert.ok(ds.filter((x) => x.code === 'UC6005').length >= 1, 'each usage flagged with the version requirement');
    assert.strictEqual(amb(ds), 0, 'no bare "Undefined variable: hostapd" cascade below the floor');
    s.notifyConfigChange({ targetVersion: '25.12' });
  });

  it('per-member floor: hostapd.udebug_set (24.10) flags on a 23.05 target; 23.05-era members do not', async () => {
    // The global exists at 23.05, but udebug_set was added in 24.10 (verified on the daemon). So on
    // a 23.05 target, only udebug_set is below the floor — printf/getpid resolve clean.
    const u = uri('permember.uc');
    s.notifyConfigChange({ targetVersion: '23.05' });
    s.openOrChangeDocument(u, "hostapd.printf('x');\nlet p = hostapd.getpid();\nhostapd.udebug_set('r', hostapd.data);\n");
    // Wait for the re-analysis at the NEW target — a predicate UNIQUE to the 23.05 state (exactly
    // one UC6005, for udebug_set), else we race the previous test's stale 22.03 diagnostics (all 4).
    const ds = await s.waitForDiagnostics(u, (d) => {
      const v = d.filter((x) => x.code === 'UC6005');
      return v.length === 1 && /udebug_set/.test(v[0].message);
    }, 8000);
    const v = ds.filter((x) => x.code === 'UC6005');
    assert.strictEqual(v.length, 1, 'only udebug_set is below the 23.05 target');
    assert.match(v[0].message, /udebug_set.*24\.10/);
    s.notifyConfigChange({ targetVersion: '25.12' });
  });

  it('hover on a hostapd method shows its typed signature', async () => {
    const hover = await s.getHover("hostapd.getpid();\n", path.join(ws, 'hover.uc'), 0, 8);
    const text = JSON.stringify(hover || {});
    assert.match(text, /getpid/);
    assert.match(text, /integer/); // typed return, not a bare identifier
  });
});
