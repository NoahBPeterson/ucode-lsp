// Quick fix for UC1001/UC1002: "Declare '<name>' as an injected global (@global)" — inserts
// a `/** @global <name> */` at the top of the file, which the LSP recognizes so the read/call
// stops being flagged. Verified round-trip: apply the edit → the diagnostic is gone.
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Declare-as-@global quick fix (UC1001/UC1002)', function () {
  this.timeout(20000);
  let s, ws;
  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'));
    s = createLSPTestServer({ workspaceRoot: ws });
    await s.initialize();
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  async function fixFor(file, code, wantCode) {
    const uri = `file://${path.join(ws, file)}`;
    s.openOrChangeDocument(uri, code);
    const ds = await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === wantCode), 8000);
    const d = ds.find(x => x.code === wantCode);
    const acts = await s.getCodeActions(path.join(ws, file), [d], d.range.start.line, d.range.start.character);
    return { uri, action: acts.find(a => /@global/.test(a.title)) };
  }

  it('offers @global on an undefined function call (UC1002) and names it correctly', async () => {
    const { uri, action } = await fixFor('call.uc', 'emit("ready");\n', 'UC1002');
    assert.ok(action, 'expected a @global quick fix');
    assert.match(action.title, /Declare 'emit'/);
    assert.strictEqual(action.edit.changes[uri][0].newText, '/** @global emit */\n');
  });

  it('offers @global on an undefined variable read (UC1001)', async () => {
    const { action } = await fixFor('read.uc', 'let x = SOME_GLOBAL;\n', 'UC1001');
    assert.ok(action, 'expected a @global quick fix');
    assert.match(action.title, /Declare 'SOME_GLOBAL'/);
  });

  it('inserts after a shebang, not on line 0', async () => {
    const { uri, action } = await fixFor('sh.uc', '#!/usr/bin/ucode\nemit("x");\n', 'UC1002');
    const edit = action.edit.changes[uri][0];
    assert.strictEqual(edit.range.start.line, 1, 'must insert below the shebang');
  });

  it('round-trip: applying the fix silences the diagnostic', async () => {
    const uri = `file://${path.join(ws, 'rt.uc')}`;
    s.openOrChangeDocument(uri, 'emit("ready");\n');
    await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === 'UC1002'), 8000);
    // apply the fix (prepend the @global comment) and wait for UC1002 to disappear
    s.openOrChangeDocument(uri, '/** @global emit */\nemit("ready");\n');
    const ds = await s.waitForDiagnostics(uri, (d) => !d.some(x => x.code === 'UC1002'), 8000)
      .catch(() => [{ code: 'UC1002' }]);
    assert.ok(!ds.some(x => x.code === 'UC1002'), 'UC1002 must be gone after declaring @global');
  });

  // ── UC8004: non-deterministic global definition ─────────────────────────────────────────

  it('UC8004 offers BOTH fixes: seed-default (preferred) and @global, named from data', async () => {
    const uri = `file://${path.join(ws, 'nd.uc')}`;
    s.openOrChangeDocument(uri, 'function boot() { global.CFG = {}; }\n');
    const ds = await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === 'UC8004'), 8000);
    const d = ds.find(x => x.code === 'UC8004');
    const acts = await s.getCodeActions(path.join(ws, 'nd.uc'), [d], d.range.start.line, d.range.start.character);
    const seed = acts.find(a => /Assign a default/.test(a.title));
    const decl = acts.find(a => /@global/.test(a.title));
    assert.ok(seed, 'expected the seed-default quick fix');
    assert.ok(decl, 'expected the @global quick fix');
    // the name must come from diagnostic.data.globalName — 'CFG', not 'global'
    assert.match(seed.title, /global\.CFG = null;/);
    assert.match(decl.title, /Declare 'CFG'/);
    assert.strictEqual(seed.isPreferred, true);
    assert.strictEqual(seed.edit.changes[uri][0].newText, 'global.CFG = null;\n');
  });

  it("UC8004 seed fix inserts BELOW a 'use strict' prologue (never above it)", async () => {
    const uri = `file://${path.join(ws, 'nds.uc')}`;
    s.openOrChangeDocument(uri, "'use strict';\nfunction boot() { global.CFG = {}; }\n");
    const ds = await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === 'UC8004'), 8000);
    const d = ds.find(x => x.code === 'UC8004');
    const acts = await s.getCodeActions(path.join(ws, 'nds.uc'), [d], d.range.start.line, d.range.start.character);
    const seed = acts.find(a => /Assign a default/.test(a.title));
    assert.ok(seed, 'expected the seed-default quick fix');
    assert.strictEqual(seed.edit.changes[uri][0].range.start.line, 1, "must insert below 'use strict'");
  });

  it('UC8004 round-trip: seeding the default silences the diagnostic', async () => {
    const uri = `file://${path.join(ws, 'ndrt.uc')}`;
    s.openOrChangeDocument(uri, 'if (getenv("X")) { global.MODE = 1; }\n');
    await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === 'UC8004'), 8000);
    s.openOrChangeDocument(uri, 'global.MODE = null;\nif (getenv("X")) { global.MODE = 1; }\n');
    const ds = await s.waitForDiagnostics(uri, (d) => !d.some(x => x.code === 'UC8004'), 8000)
      .catch(() => [{ code: 'UC8004' }]);
    assert.ok(!ds.some(x => x.code === 'UC8004'), 'UC8004 must be gone after seeding a default');
  });

  it('UC8005 (read of a shaky global) offers the same two fixes, named from data', async () => {
    const uri = `file://${path.join(ws, 'rd.uc')}`;
    s.openOrChangeDocument(uri, 'function boot() { global.CFG = {}; }\nprint(CFG);\n');
    const ds = await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === 'UC8005'), 8000);
    const d = ds.find(x => x.code === 'UC8005');
    const acts = await s.getCodeActions(path.join(ws, 'rd.uc'), [d], d.range.start.line, d.range.start.character);
    assert.ok(acts.find(a => /global\.CFG = null;/.test(a.title)), 'expected the seed-default fix');
    assert.ok(acts.find(a => /Declare 'CFG'/.test(a.title)), 'expected the @global fix');
  });

  it('UC8004 round-trip: declaring @global silences the diagnostic', async () => {
    const uri = `file://${path.join(ws, 'ndrt2.uc')}`;
    s.openOrChangeDocument(uri, 'function boot() { global.CFG = {}; }\nboot;\n');
    // (bare `boot;` reference avoids the unconditional-call suppression proving it deterministic)
    await s.waitForDiagnostics(uri, (d) => d.some(x => x.code === 'UC8004'), 8000);
    s.openOrChangeDocument(uri, '/** @global CFG */\nfunction boot() { global.CFG = {}; }\nboot;\n');
    const ds = await s.waitForDiagnostics(uri, (d) => !d.some(x => x.code === 'UC8004'), 8000)
      .catch(() => [{ code: 'UC8004' }]);
    assert.ok(!ds.some(x => x.code === 'UC8004'), 'UC8004 must be gone after declaring @global');
  });
});
