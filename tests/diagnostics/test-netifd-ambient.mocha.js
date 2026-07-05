// The `netifd` injected global — typed, handler-gated, version-gated ambient (like uhttpd).
// Two shapes from netifd's C source (docs/netifd-injected-global.md):
//   - proto handler  `netifd = { add_proto }`         → OpenWrt main+
//   - daemon/wireless rich C global (log/process/...) → OpenWrt 25.12+
// Seeded only when a script actually uses netifd; a non-netifd file's `netifd` stays UC1001.
// Tests start at the 25.12 default and drive version boundaries with notifyConfigChange, each
// assertion waiting for the post-change predicate (avoids racing the async config read).
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('netifd ambient (typed, handler + version gated)', function () {
  this.timeout(20000);
  let s, ws;
  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'netifd-'));
    s = createLSPTestServer({
      workspaceRoot: ws,
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      configuration: { ucode: { targetVersion: '25.12' } },
    });
    await s.initialize();
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  const uri = (name) => `file://${path.join(ws, name)}`;
  const netifd1001 = (ds) => ds.filter((d) => d.code === 'UC1001' && /\bnetifd\b/.test(d.message)).length;

  // Daemon shape (log/process/L_WARNING) resolves at the 25.12 default; proto shape needs main.
  const PROTO = "'use strict';\nfunction cfg(ctx){ return {}; }\nnetifd.add_proto({ name: 'x', config: cfg });\n";
  const DAEMON = "'use strict';\nnetifd.log(netifd.L_WARNING, 'hi');\nlet p = netifd.process({ argv: ['/bin/x'], cb: () => {} });\n";

  it('daemon/wireless script resolves netifd at the 25.12 default', async () => {
    const u = uri('daemon1.uc');
    s.openOrChangeDocument(u, DAEMON);
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    assert.strictEqual(netifd1001(ds), 0, 'netifd.log/process/L_WARNING should resolve on 25.12');
  });

  it('daemon netifd is OPEN: a runtime-extended member (netifd.ubus/setup_failed) is not UC5004', async () => {
    // The daemon extends netifd in ucode (`netifd.ubus = …`) and the wireless framework adds
    // members outside the C table; those must resolve to `unknown`, not error.
    const u = uri('open.uc');
    s.openOrChangeDocument(u, "'use strict';\nnetifd.log(netifd.L_WARNING, 'x');\nnetifd.ubus.call('x', 'y');\nnetifd.setup_failed('BOOM');\n");
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    assert.strictEqual(ds.filter((x) => x.code === 'UC5004').length, 0, 'extended daemon members must not error');
    assert.strictEqual(netifd1001(ds), 0, 'netifd still resolves (no UC1001)');
  });

  const labelsOf = (r) => (Array.isArray(r) ? r : (r && r.items) || []).map((i) => i.label);

  it('hover on a daemon method shows its typed signature', async () => {
    // `netifd.log` at line 1 (0-based), on the `log` identifier (char 8).
    const hover = await s.getHover("'use strict';\nnetifd.log(netifd.L_WARNING, 'x');\n", path.join(ws, 'hover.uc'), 1, 8);
    const text = JSON.stringify(hover || {});
    assert.match(text, /log/);
    assert.match(text, /priority|integer/); // the typed signature, not a bare identifier
  });

  it('completion after `netifd.` on a daemon script offers the daemon members', async () => {
    // A prior complete usage (netifd.log) classifies the shape; then `netifd.` on line 2 completes.
    const labels = labelsOf(await s.getCompletions("'use strict';\nnetifd.log(netifd.L_WARNING, 'x');\nnetifd.\n", path.join(ws, 'comp.uc'), 2, 7));
    assert.ok(labels.includes('log') && labels.includes('process') && labels.includes('L_WARNING'),
      `daemon members expected in completion, got: ${labels.slice(0, 12).join(', ')}`);
  });

  it('a canonical netifd path resolves (and completes) even before the first complete usage', async () => {
    // File at .../lib/netifd/wireless.uc → daemon shape by PATH alone; `netifd.` completes.
    const p = path.join(ws, 'lib', 'netifd', 'wireless.uc');
    const labels = labelsOf(await s.getCompletions("'use strict';\nnetifd.\n", p, 1, 7));
    assert.ok(labels.includes('log') && labels.includes('device_set'),
      `path-based daemon completion expected, got: ${labels.slice(0, 12).join(', ')}`);
  });

  it('a non-netifd script referencing `netifd` still gets UC1001', async () => {
    const u = uri('random.uc');
    s.openOrChangeDocument(u, "'use strict';\nprint(netifd);\n");
    const ds = await s.waitForDiagnostics(u, (d) => netifd1001(d) >= 1, 8000);
    assert.ok(netifd1001(ds) >= 1, 'netifd is not injected into an ordinary script');
  });

  it('a local `let netifd` is NOT treated as the ambient (no over-injection)', async () => {
    const u = uri('local.uc');
    s.openOrChangeDocument(u, "'use strict';\nlet netifd = { log: () => {} };\nnetifd.frobnicate();\n");
    const ds = await s.waitForDiagnostics(u, (d) => Array.isArray(d), 8000);
    assert.strictEqual(ds.filter((x) => x.code === 'UC5004').length, 0, 'a user-declared netifd is its own object, not the ambient');
  });

  it('version gate: proto handler needs main → UC6005 (not a bare UC1001) at 25.12, clean at main', async () => {
    // Below the floor the ambient resolves as a PLAIN object (no bare UC1001) with one actionable
    // UC6005 — but the main-only API is NOT typed, so it isn't hovered/completed on 25.12.
    const u = uri('proto.uc');
    const fp = path.join(ws, 'proto.uc');
    s.openOrChangeDocument(u, PROTO);
    let ds = await s.waitForDiagnostics(u, (d) => d.some((x) => x.code === 'UC6005'), 8000);
    const v = ds.find((x) => x.code === 'UC6005');
    assert.ok(v && /main/.test(v.message), 'proto handler flags UC6005 pointing at main');
    // Anchored on the member `add_proto` (PROTO line 2 is `netifd.add_proto(...)`; add_proto starts
    // at col 7), NOT on the `netifd` object at col 0.
    assert.strictEqual(v.range.start.line, 2, 'on the netifd.add_proto line');
    assert.strictEqual(v.range.start.character, 7, 'anchored on `add_proto`, not `netifd`');
    assert.strictEqual(netifd1001(ds), 0, 'netifd still resolves — no bare UC1001 cascade');
    // At 25.12 the main-only `add_proto` must NOT be offered in completion.
    let labels = labelsOf(await s.getCompletions(PROTO, fp, 2, 7));
    assert.ok(!labels.includes('add_proto'), `add_proto must NOT complete at 25.12, got: ${labels.slice(0, 10).join(', ')}`);

    s.notifyConfigChange({ targetVersion: 'main' });
    ds = await s.waitForDiagnostics(u, (d) => !d.some((x) => x.code === 'UC6005'), 8000);
    assert.strictEqual(ds.filter((x) => x.code === 'UC6005').length, 0, 'no version flag once on main');
    assert.strictEqual(netifd1001(ds), 0, 'resolves cleanly on main');
    // At main the typed shape is active → add_proto completes.
    labels = labelsOf(await s.getCompletions(PROTO, fp, 2, 7));
    assert.ok(labels.includes('add_proto'), `add_proto should complete at main, got: ${labels.slice(0, 10).join(', ')}`);
  });

  it('gated-out: EVERY netifd usage is flagged (not just the first), so none looks fine', async () => {
    // Still at 'main' from the previous test → switch to 25.12 where proto is gated out.
    s.notifyConfigChange({ targetVersion: '25.12' });
    const u = uri('multi.uc');
    s.openOrChangeDocument(u, "'use strict';\nnetifd.add_proto({ name: 'x' });\nnetifd.add_proto({});\nnetifd.foo();\n");
    const ds = await s.waitForDiagnostics(u, (d) => d.filter((x) => x.code === 'UC6005').length >= 3, 8000);
    assert.strictEqual(ds.filter((x) => x.code === 'UC6005').length, 3, 'each of the 3 netifd usages flagged');
    assert.strictEqual(netifd1001(ds), 0, 'no bare UC1001');
  });

  it('proto netifd is STRICT: an unknown member on the { add_proto } stub is UC5004 (at main)', async () => {
    s.notifyConfigChange({ targetVersion: 'main' });
    // Target is 'main' from the previous test. The proto stub is exactly { add_proto }, so a
    // typo is a real error — unlike the open daemon shape.
    const u = uri('prototypo.uc');
    s.openOrChangeDocument(u, "'use strict';\nnetifd.add_proto({ name: 'x' });\nnetifd.frobnicate();\n");
    const ds = await s.waitForDiagnostics(u, (d) => d.some((x) => x.code === 'UC5004'), 8000);
    assert.ok(ds.some((x) => x.code === 'UC5004' && /frobnicate/.test(x.message)), 'unknown proto member → UC5004');
  });

  it('proto completion offers `add_proto` but NOT daemon-only members (distinct shapes, at main)', async () => {
    // Still at 'main' from the previous tests → proto stub resolves.
    const labels = labelsOf(await s.getCompletions("'use strict';\nnetifd.add_proto({ name: 'x' });\nnetifd.\n", path.join(ws, 'protocomp.uc'), 2, 7));
    assert.ok(labels.includes('add_proto'), `proto completion should offer add_proto, got: ${labels.slice(0, 12).join(', ')}`);
    assert.ok(!labels.includes('device_set') && !labels.includes('interface_get_bridge'),
      'proto shape must NOT expose daemon-only members');
  });

  it('version gate: daemon netifd needs 25.12 → UC6005 (not a bare UC1001) at 24.10', async () => {
    s.notifyConfigChange({ targetVersion: '24.10' });
    const u = uri('daemon24.uc');
    s.openOrChangeDocument(u, DAEMON);
    const ds = await s.waitForDiagnostics(u, (d) => d.some((x) => x.code === 'UC6005'), 8000);
    assert.ok(ds.some((x) => x.code === 'UC6005' && /25\.12/.test(x.message)), 'daemon flags UC6005 requiring 25.12');
    assert.strictEqual(netifd1001(ds), 0, 'netifd still resolves — no bare UC1001');
  });
});
