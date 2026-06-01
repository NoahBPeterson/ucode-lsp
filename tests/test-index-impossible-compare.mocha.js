const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// index()/rindex() return -1 (not found) or a non-negative index — never below
// -1. Comparing the result against a literal <= -2 is therefore a constant (dead)
// test, almost always an off-by-one on the -1 sentinel. UC2009 flags it; the
// legitimate `== -1` / `!= -1` / `>= 0` not-found idioms are NOT flagged.
describe('Impossible index()/rindex() comparison (UC2009)', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/idx-cmp.uc';
  const uc2009 = async (code) =>
    (await getDiagnostics(code, FP)).filter(d => d.code === 'UC2009');

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  it('flags `index(s,x) != -2` as always true', async () => {
    const ds = await uc2009(`let s = "x"; let r = index(s, 'm') != -2;`);
    assert.strictEqual(ds.length, 1);
    assert.match(ds[0].message, /always true/);
  });

  it('flags `== -2` as always false, `< -2`/`<= -2` false, `> -2`/`>= -2` true', async () => {
    assert.match((await uc2009(`let s="x"; let r = index(s,'m') == -2;`))[0].message, /always false/);
    assert.match((await uc2009(`let s="x"; let r = index(s,'m') < -3;`))[0].message, /always false/);
    assert.match((await uc2009(`let s="x"; let r = index(s,'m') > -3;`))[0].message, /always true/);
    assert.match((await uc2009(`let s="x"; let r = index(s,'m') >= -3;`))[0].message, /always true/);
  });

  it('handles the literal on the LEFT (`-5 > index(...)`)', async () => {
    assert.strictEqual((await uc2009(`let s="x"; let r = (-5 > index(s,'m'));`)).length, 1);
  });

  it('flags rindex() too', async () => {
    assert.strictEqual((await uc2009(`let s="x"; let r = rindex(s,'m') != -2;`)).length, 1);
  });

  it('is an ERROR in strict mode, a warning otherwise', async () => {
    assert.strictEqual((await uc2009(`'use strict';\nlet s="x"; let r = index(s,'m') != -2;`))[0].severity, 1);
    assert.strictEqual((await uc2009(`let s="x"; let r = index(s,'m') != -2;`))[0].severity, 2);
  });

  // ── No false positives on legitimate idioms ─────────────────────────────
  it('does NOT flag the not-found idioms (`== -1`, `!= -1`, `< 0`, `>= 0`)', async () => {
    assert.strictEqual((await uc2009(`let s="x"; if (index(s,'m') == -1) print(1);`)).length, 0);
    assert.strictEqual((await uc2009(`let s="x"; if (index(s,'m') != -1) print(1);`)).length, 0);
    assert.strictEqual((await uc2009(`let s="x"; if (index(s,'m') < 0) print(1);`)).length, 0);
    assert.strictEqual((await uc2009(`let s="x"; if (index(s,'m') >= 0) print(1);`)).length, 0);
  });

  it('does NOT flag comparisons of an UNRANGED function (int() can be negative)', async () => {
    assert.strictEqual((await uc2009(`let s="x"; let r = int(s) != -2;`)).length, 0);
  });

  // ── Generalization: the same machinery covers length() (range [0, ∞)) ──────
  it('flags length() against out-of-range literals (general, not index-specific)', async () => {
    assert.match((await uc2009(`let a=[1]; let r = length(a) < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`let a=[1]; let r = length(a) == -1;`))[0].message, /always false/);
    assert.match((await uc2009(`let a=[1]; let r = length(a) >= 0;`))[0].message, /always true/);
  });

  it('does NOT flag legitimate length() comparisons (`> 0`, `== 5`)', async () => {
    assert.strictEqual((await uc2009(`let a=[1]; let r = length(a) > 0;`)).length, 0);
    assert.strictEqual((await uc2009(`let a=[1]; let r = length(a) == 5;`)).length, 0);
  });

  it('flags `index() < -1` too (full range reasoning, not just `<= -2`)', async () => {
    assert.match((await uc2009(`let s="x"; let r = index(s,'m') < -1;`))[0].message, /always false/);
  });

  // ── math module functions (bounded/signed ranges, return NaN) ──────────────
  it('flags out-of-range math comparisons (cos/sin/abs/sqrt/exp/atan2)', async () => {
    assert.match((await uc2009(`import { cos } from 'math';\nlet r = cos(0) > 1;`))[0].message, /always false/);
    assert.match((await uc2009(`import { sin } from 'math';\nlet r = sin(0) < -1;`))[0].message, /always false/);
    assert.match((await uc2009(`import { abs } from 'math';\nlet r = abs(-5) < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`import { sqrt } from 'math';\nlet r = sqrt(4) < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`import { exp } from 'math';\nlet r = exp(2) < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`import { atan2 } from 'math';\nlet r = atan2(1,1) > 4;`))[0].message, /always false/);
  });

  it('works through a namespace import (`math.sin(x) < -1`)', async () => {
    assert.strictEqual((await uc2009(`import * as math from 'math';\nlet r = math.sin(0) < -1;`)).length, 1);
  });

  it('NaN soundness: does NOT flag always-true math comparisons (cos<=1, abs>=0)', async () => {
    // cos/abs can be NaN, and NaN <= 1 / NaN >= 0 are false — so these are NOT
    // constant-true and must not be flagged.
    assert.strictEqual((await uc2009(`import { cos } from 'math';\nlet r = cos(0) <= 1;`)).length, 0);
    assert.strictEqual((await uc2009(`import { abs } from 'math';\nlet r = abs(-5) >= 0;`)).length, 0);
  });

  it('does NOT flag a USER function shadowing a math name (import not verified)', async () => {
    assert.strictEqual((await uc2009(`function abs(x){ return x; }\nlet r = abs(-5) < 0;`)).length, 0);
  });

  it('does NOT flag unbounded math functions (log, pow)', async () => {
    assert.strictEqual((await uc2009(`import { log } from 'math';\nlet r = log(2) < 0;`)).length, 0);
    assert.strictEqual((await uc2009(`import { pow } from 'math';\nlet r = pow(2,3) < 0;`)).length, 0);
  });

  // ── ord() [0,255] and system() (≤255, but negative on signal) ──────────────
  it('flags out-of-range ord() comparisons ([0, 255])', async () => {
    assert.match((await uc2009(`let r = ord("A") < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`let r = ord("A") > 255;`))[0].message, /always false/);
    assert.match((await uc2009(`let r = ord("A") == 300;`))[0].message, /always false/);
  });

  it('does NOT flag legit ord() comparisons (`== 65`, `>= 0` boundary aside)', async () => {
    assert.strictEqual((await uc2009(`let r = ord("A") == 65;`)).length, 0);
  });

  it('flags `system() > 255` / `== 256` (exit codes cap at 255)', async () => {
    assert.match((await uc2009(`let r = system("x") > 255;`))[0].message, /always false/);
    assert.match((await uc2009(`let r = system("x") == 256;`))[0].message, /always false/);
  });

  it('does NOT flag `system() < 0` — signal kills return a negative signal number', async () => {
    assert.strictEqual((await uc2009(`let r = system("x") < 0;`)).length, 0);
    assert.strictEqual((await uc2009(`let r = system("x") == 0;`)).length, 0);
  });

  // ── trace() returns the previous trace level, a uint8_t [0, 255] ────────────
  it('flags out-of-range trace() comparisons ([0, 255])', async () => {
    assert.match((await uc2009(`let r = trace(0) < 0;`))[0].message, /always false/);
    assert.match((await uc2009(`let r = trace(0) > 255;`))[0].message, /always false/);
    assert.match((await uc2009(`let r = trace(0) >= 0;`))[0].message, /always true/);
  });

  it('does NOT flag legit trace() comparisons (`== 0`, `== 2`)', async () => {
    assert.strictEqual((await uc2009(`let r = trace(0) == 0;`)).length, 0);
    assert.strictEqual((await uc2009(`let r = trace(0) == 2;`)).length, 0);
  });
});
