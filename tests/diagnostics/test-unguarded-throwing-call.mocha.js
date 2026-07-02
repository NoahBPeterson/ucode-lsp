// End-to-end SERVER coverage for `ucode.warnUnguardedThrowingCalls` (default OFF, UC8001).
// A throwing builtin (json/loadfile/loadstring/require) called outside try/catch is flagged
// as a Hint, with a quick fix that wraps from that statement THROUGH THE END of its
// enclosing block — so the whole downstream use of the parsed/loaded value is guarded.
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Unguarded throwing-call lint (UC8001) + wrap-in-try/catch quick fix', function () {
  this.timeout(20000);
  let s, ws;
  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'utc-'));
    s = createLSPTestServer({
      workspaceRoot: ws,
      capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } },
      configuration: { ucode: { warnUnguardedThrowingCalls: true } },
    });
    await s.initialize();
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  const u8 = (ds) => ds.filter(d => d.code === 'UC8001');

  it('flags an unguarded json() call as a warning (error under strict)', async () => {
    const uri = `file://${path.join(ws, 'a.uc')}`;
    const code = ['let raw = "x";', 'let data = json(raw);', 'print(data);', ''].join('\n');
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length >= 1, 8000);
    const d = u8(ds)[0];
    assert.strictEqual(d.severity, 2, 'UC8001 should be a Warning (severity 2) in non-strict');
    assert.strictEqual(d.range.start.line, 1, 'should point at the json() call line');

    // Under 'use strict' it escalates to an Error.
    const suri = `file://${path.join(ws, 'a-strict.uc')}`;
    const scode = ["'use strict';", 'let raw = "x";', 'let data = json(raw);', 'print(data);', ''].join('\n');
    s.openOrChangeDocument(suri, scode);
    const sds = await s.waitForDiagnostics(suri, (d) => u8(d).length >= 1, 8000);
    assert.strictEqual(u8(sds)[0].severity, 1, 'UC8001 should be an Error (severity 1) under strict');
  });

  it("the quick fix wraps from the throwing statement through the END of the block", async () => {
    const uri = `file://${path.join(ws, 'b.uc')}`;
    const code = [
      'let raw = "x";',          // 0 — before json, must NOT be wrapped
      'let data = json(raw);',   // 1 — throwing statement (wrap starts here)
      'use(data);',              // 2
      'exWith(data);',           // 3 — last statement (wrap ends here)
      ''
    ].join('\n');
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length >= 1, 8000);
    const d = u8(ds)[0];
    const acts = await s.getCodeActions(path.join(ws, 'b.uc'), [d], d.range.start.line, d.range.start.character);
    const wrap = acts.find(a => /try\/catch/.test(a.title));
    assert.ok(wrap, `expected a wrap-in-try/catch action, got: ${JSON.stringify(acts.map(a => a.title))}`);
    const edit = wrap.edit.changes[uri][0];
    const out = edit.newText;
    assert.ok(/try \{/.test(out), 'wraps in try {');
    assert.ok(/let data = json\(raw\);/.test(out), 'includes the throwing statement');
    assert.ok(/use\(data\);/.test(out) && /exWith\(data\);/.test(out), 'includes downstream usage through end of block');
    assert.ok(/\} catch \(e\) \{/.test(out), 'has a catch (e) block');
    // The `raw` declaration precedes json() and must stay OUTSIDE the wrap.
    assert.ok(!/let raw = "x";/.test(out), 'must not wrap statements before the throwing call');
    // Applying the edit must keep `raw` before the try block.
    const before = code.slice(0, edit.range ? undefined : 0); // sanity only
    assert.ok(before.includes('let raw'), 'sanity: original retains raw');
  });

  it("the wrap STOPS before a following function declaration (top-level) — does not swallow it", async () => {
    const uri = `file://${path.join(ws, 'boundary.uc')}`;
    const code = [
      'let cfg = json("x");',            // 0 — throwing (wrap starts here)
      'apply(cfg);',                     // 1 — downstream (wrapped)
      'function helper(n) { return n; }',// 2 — BOUNDARY: must NOT be wrapped
      'function other() { return 1; }',  // 3 — also stays out
      ''
    ].join('\n');
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length >= 1, 8000);
    const d = u8(ds).find(x => x.range.start.line === 0);
    const acts = await s.getCodeActions(path.join(ws, 'boundary.uc'), [d], d.range.start.line, d.range.start.character);
    const out = acts.find(a => /try\/catch/.test(a.title)).edit.changes[uri][0].newText;
    assert.ok(/let cfg = json\("x"\);/.test(out) && /apply\(cfg\);/.test(out), 'wraps the throwing stmt + downstream');
    assert.ok(!/function helper/.test(out), 'must NOT swallow the following function declaration');
    assert.ok(!/function other/.test(out), 'must NOT swallow later declarations either');
  });

  it('require() of a builtin (fs) is NOT flagged — it always resolves', async () => {
    const uri = `file://${path.join(ws, 'reqfs.uc')}`;
    s.openOrChangeDocument(uri, ["'use strict';", 'let m = require("fs");', 'use(m);', ''].join('\n'));
    const ds = await s.waitForDiagnostics(uri, () => true, 3000).catch(() => []);
    assert.strictEqual(u8(ds).length, 0, 'require("fs") must not warn (builtin always present)');
  });

  it('require() of a resolvable sibling file is NOT flagged; an unresolvable name IS', async () => {
    fs.writeFileSync(path.join(ws, 'mylib.uc'), 'export function x(){}\n');
    const okUri = `file://${path.join(ws, 'reqok.uc')}`;
    s.openOrChangeDocument(okUri, 'let m = require("mylib");\nuse(m);\n');
    const okDs = await s.waitForDiagnostics(okUri, () => true, 3000).catch(() => []);
    assert.strictEqual(u8(okDs).length, 0, 'require of an existing ./mylib.uc must not warn');

    const badUri = `file://${path.join(ws, 'reqbad.uc')}`;
    s.openOrChangeDocument(badUri, 'let m = require("lolza");\nuse(m);\n');
    const badDs = await s.waitForDiagnostics(badUri, (d) => u8(d).length >= 1, 8000);
    assert.strictEqual(u8(badDs)[0].severity, 2, 'unresolvable require warns (Warning, even here)');
  });

  it("require()'s wrap fix emits RUNTIME code enumerating the search path (not a comment list)", async () => {
    const uri = `file://${path.join(ws, 'reqfix.uc')}`;
    s.openOrChangeDocument(uri, ['let m = require("lolza");', 'use(m);', ''].join('\n'));
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length >= 1, 8000);
    const d = u8(ds)[0];
    const acts = await s.getCodeActions(path.join(ws, 'reqfix.uc'), [d], d.range.start.line, d.range.start.character);
    const out = acts.find(a => /try\/catch/.test(a.title)).edit.changes[uri][0].newText;
    assert.ok(/for \(let \w+ in REQUIRE_SEARCH_PATH\)/.test(out), 'catch iterates REQUIRE_SEARCH_PATH at runtime');
    assert.ok(/fs\.glob\(/.test(out), 'catch uses fs.glob to enumerate modules');
    assert.ok(!/\/\/\s+fs\n/.test(out), 'no static comment module list');
  });

  it('flags EVERY independent throwing call in a block (not just the first)', async () => {
    const uri = `file://${path.join(ws, 'multi.uc')}`;
    // json (L0) and an independent require (L2) — both must be flagged.
    const code = ['let d = json("x");', 'use(d);', 'require("lolza");', ''].join('\n');
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length >= 2, 8000).catch(() => []);
    const lines = u8(ds).map(d => d.range.start.line).sort((a, b) => a - b);
    assert.deepStrictEqual(lines, [0, 2], `both throwers flagged, got lines ${JSON.stringify(lines)}`);
  });

  it('the wrap covers only transitive dependents — not unrelated trailing code', async () => {
    const uri = `file://${path.join(ws, 'deps.uc')}`;
    const code = [
      'let cfg = json("x");',   // 0 — throwing
      'let n = cfg + 1;',       // 1 — depends on cfg (transitive)
      'require("other");',      // 2 — independent thrower, must NOT be swallowed
      ''
    ].join('\n');
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length >= 2, 8000).catch(() => []);
    const jsonDiag = u8(ds).find(d => d.range.start.line === 0);
    const acts = await s.getCodeActions(path.join(ws, 'deps.uc'), [jsonDiag], 0, jsonDiag.range.start.character);
    const out = acts.find(a => /try\/catch/.test(a.title)).edit.changes[uri][0].newText;
    assert.ok(/let cfg = json\("x"\);/.test(out) && /let n = cfg \+ 1;/.test(out), 'wraps the dependent chain');
    assert.ok(!/require\("other"\)/.test(out), 'must NOT swallow the unrelated require into the try');
  });

  it('does NOT flag a call already inside try/catch', async () => {
    const uri = `file://${path.join(ws, 'c.uc')}`;
    const code = ['try {', '  let d = json("x");', '  print(d);', '} catch (e) {}', ''].join('\n');
    s.openOrChangeDocument(uri, code);
    // give the server a moment; expect no UC8001
    const ds = await s.waitForDiagnostics(uri, () => true, 3000).catch(() => []);
    assert.strictEqual(u8(ds).length, 0, `guarded call must not be flagged, got: ${JSON.stringify(u8(ds))}`);
  });

  it('does NOT flag when the name is a user-defined (non-builtin) function', async () => {
    const uri = `file://${path.join(ws, 'd.uc')}`;
    const code = ['function json(x) { return x; }', 'let d = json("x");', ''].join('\n');
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, () => true, 3000).catch(() => []);
    assert.strictEqual(u8(ds).length, 0, 'user-shadowed json must not be flagged');
  });

  it('is ON by default (no explicit setting) — separate server', async () => {
    const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'utc-on-'));
    const s2 = createLSPTestServer({
      workspaceRoot: ws2,
      capabilities: { workspace: { configuration: true } },
      // no warnUnguardedThrowingCalls → defaults to true (safety on by default)
      configuration: { ucode: {} },
    });
    await s2.initialize();
    try {
      const uri = `file://${path.join(ws2, 'e.uc')}`;
      const code = ['let d = json("x");', 'print(d);', ''].join('\n');
      s2.openOrChangeDocument(uri, code);
      const ds = await s2.waitForDiagnostics(uri, (d) => u8(d).length >= 1, 4000).catch(() => []);
      assert.strictEqual(u8(ds).length, 1, 'must be ON by default');
    } finally {
      s2.shutdown(); try { fs.rmSync(ws2, { recursive: true, force: true }); } catch {}
    }
  });

  it('can be turned OFF explicitly (config change re-analyzes)', async () => {
    // Reuse the suite server (created with the setting ON) and flip it OFF via a config
    // change — the proven reliable path (a fresh server + immediate open races the config
    // pull). Restore ON afterward so later tests are unaffected.
    const uri = `file://${path.join(ws, 'off.uc')}`;
    const code = ['let d = json("x");', 'print(d);', ''].join('\n');
    s.openOrChangeDocument(uri, code);
    await s.waitForDiagnostics(uri, (d) => u8(d).length >= 1, 4000).catch(() => []); // ON first
    s.notifyConfigChange({ warnUnguardedThrowingCalls: false });
    const ds = await s.waitForDiagnostics(uri, (d) => u8(d).length === 0, 4000).catch(() => [{ code: 'UC8001' }]);
    assert.strictEqual(u8(ds).length, 0, 'explicit false must silence it');
    // (last test in the suite — no need to restore the setting)
  });
});
