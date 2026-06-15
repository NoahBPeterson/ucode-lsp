const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// UC2009 extended to METHODS on known handle objects: fs.file / fs.proc /
// io.handle (write/tell/fileno return a non-negative int or null), fs.proc.close
// (exit code ≤255 or a negative signal), and uloop timer/interval remaining()
// (-1 or a non-negative ms count). Gated on the receiver provably being that
// handle type — a user object's same-named method is NEVER flagged.
describe('Impossible handle-method comparison (UC2009)', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/handle-cmp.uc';
  const uc2009 = async (code) =>
    (await getDiagnostics(code, FP)).filter(d => d.code === 'UC2009');

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  const FS = `import * as fs from 'fs';\n`;
  const ULOOP = `import * as uloop from 'uloop';\n`;

  // ── fs.file: write/tell/fileno return a non-negative int (or null) ──────────
  it('flags `fs.file.tell() < 0` as always false', async () => {
    const ds = await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.tell() < 0;`);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /always false/);
    assert.match(ds[0].message, /fs\.file\.tell/);
  });

  it('flags `fs.file.fileno() == -1` (a JS-ism — ucode returns null, not -1)', async () => {
    assert.match((await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.fileno() == -1;`))[0].message, /always false/);
  });

  it('flags `fs.file.write() < 0` and `fs.file.tell() >= 0` (always true — null coerces to 0)', async () => {
    assert.match((await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.write("x") < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.tell() >= 0;`))[0].message, /always true/);
  });

  it('does NOT flag legitimate fs.file comparisons (`> 5`, `== 0`, `!= null`-style)', async () => {
    assert.strictEqual((await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.tell() > 5;`)).length, 0);
    assert.strictEqual((await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.write("x") == 0;`)).length, 0);
  });

  // ── fs.proc.close(): exit code ≤255, OR a negative signal number ────────────
  it('flags `fs.proc.close() > 255` / `== 256` (exit codes cap at 255)', async () => {
    assert.match((await uc2009(`${FS}let p = fs.popen('x','r'); let r = p.close() > 255;`))[0].message, /always false/);
    assert.match((await uc2009(`${FS}let p = fs.popen('x','r'); let r = p.close() == 256;`))[0].message, /always false/);
  });

  it('does NOT flag `fs.proc.close() < 0` — a signal kill returns a negative number', async () => {
    assert.strictEqual((await uc2009(`${FS}let p = fs.popen('x','r'); let r = p.close() < 0;`)).length, 0);
  });

  // ── uloop timer/interval remaining(): -1 or a non-negative ms count ─────────
  it('flags `uloop.timer.remaining() < -1` as always false', async () => {
    assert.match((await uc2009(`${ULOOP}let t = uloop.timer(100); let r = t.remaining() < -1;`))[0].message, /always false/);
  });

  it('does NOT flag the `remaining() != -1` not-armed idiom', async () => {
    assert.strictEqual((await uc2009(`${ULOOP}let t = uloop.timer(100); if (t.remaining() != -1) print(1);`)).length, 0);
  });

  // ── Soundness: only fires when the receiver is provably a handle type ───────
  it('does NOT flag a same-named method on a plain user object', async () => {
    assert.strictEqual((await uc2009(`let o = { tell: function() { return -5; } }; let r = o.tell() < 0;`)).length, 0);
    assert.strictEqual((await uc2009(`let o = {}; let r = o.fileno() == -1;`)).length, 0);
  });

  it('does NOT flag a method named like a handle method on an unknown receiver', async () => {
    assert.strictEqual((await uc2009(`function getit(x) { return x; } let r = getit(1).tell() < 0;`)).length, 0);
  });

  it('is an Error regardless of strict mode (#106 — deterministic bug)', async () => {
    assert.strictEqual((await uc2009(`'use strict';\n${FS}let f = fs.open('/x','w'); let r = f.tell() < 0;`))[0].severity, 1);
    assert.strictEqual((await uc2009(`${FS}let f = fs.open('/x','w'); let r = f.tell() < 0;`))[0].severity, 1);
  });
});
