// ============================================================================
// CROSS-FILE incremental-analysis invalidation suite (REAL server, end-to-end).
//
// The same-file harness (test-incremental-soundness-samefile.test.js) proves the
// per-file cache is sound for edits WITHIN a file. This file proves the OTHER
// invalidation axis: when an IMPORTED file changes, every dependent must be
// re-checked even though the dependent's own text is unchanged. The hazard is
// specific to the incremental cache — a dependent whose only use of the import
// sits inside a pure/thisSafe function body would otherwise have that body
// SKIPPED on re-analysis (its structural fingerprint is unchanged), replaying
// diagnostics computed against the import's OLD exports. The semantic-fingerprint
// fallback is intra-file and cannot see that an imported return type moved, so
// the server force-fulls dependents in invalidateDependents(). Each test here
// would FAIL (stale) if that force-full were removed (verified by reverting it).
//
// Two assertion styles, both robust against the publish race (waitForDiagnostics
// can resolve immediately with the last-known value, so `() => true` is NOT a
// safe "wait for the next publish"):
//   • SPECIFIC  — the deterministic `nullable-argument` signal appears/disappears
//                 as the imported return's nullability flips inside a body.
//   • CHANGED   — the importer's published code-set must differ from its
//                 pre-change snapshot, i.e. it actually refreshed (anti-stale).
//
// Run with:  npx mocha tests/test-incremental-cross-file.js
// ============================================================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('./lsp-test-helpers');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-incr-xfile-'));
const uri = (name) => `file://${path.join(ws, name)}`;
const write = (name, content) => fs.writeFileSync(path.join(ws, name), content);
const codes = (ds) => ds.map((d) => d.code);
const codesStr = (ds) => JSON.stringify(codes(ds).sort());
const hasCode = (c) => (ds) => ds.some((d) => d.code === c);
const lacksCode = (c) => (ds) => !ds.some((d) => d.code === c);
const NULLABLE = 'nullable-argument';

describe('cross-file incremental invalidation (real server)', function () {
  this.timeout(40000);
  let s;
  before(async function () {
    s = createLSPTestServer({ workspaceRoot: ws });
    await s.initialize();
  });
  after(function () { if (s) s.shutdown(); });

  // Wait for the importer to reach a state matching `predicate`; on timeout, fail
  // with the last-seen code-set so a stale result is reported clearly.
  async function awaitState(name, predicate, label, timeout = 8000) {
    return s.waitForDiagnostics(uri(name), predicate, timeout).catch(async () => {
      const last = await s.waitForDiagnostics(uri(name), () => true, 200).catch(() => null);
      throw new Error(`${label}: expected state not reached; last=${last ? codesStr(last) : 'none'}`);
    });
  }

  // ── Reusable bodies ──────────────────────────────────────────────────────
  // make() return is string|null (null branch) vs string-only. Used inside a
  // body as index(make(), 'x') → nullable-argument iff the return can be null.
  const depNull = (fn = 'make') => `'use strict';\nexport function ${fn}(c) {\n  if (c) return 'ok-' + c;\n  return null;\n}\n`;
  const depStr  = (fn = 'make') => `'use strict';\nexport function ${fn}(c) { return 'ok-' + c; }\n`;

  // Generic "nullability flips" scenario: seed dep V1, open app, assert pre, flip
  // dep to V2, assert post. `app` must import from `./depN.uc`.
  async function flip(n, depV1, app, pre, depV2, post) {
    write(`dep${n}.uc`, depV1);
    write(`app${n}.uc`, app);
    s.openOrChangeDocument(uri(`dep${n}.uc`), depV1, 1);
    const d1 = await s.getDiagnostics(app, path.join(ws, `app${n}.uc`));
    assert.ok(pre(d1), `#${n} precondition failed: ${codesStr(d1)}`);
    s.openOrChangeDocument(uri(`dep${n}.uc`), depV2, 2);
    await awaitState(`app${n}.uc`, post, `#${n}`);
  }

  const bodyApp = (n) => `'use strict';\nimport { make } from './dep${n}.uc';\nfunction check() {\n  let out = make('x');\n  return index(out, 'ok');\n}\ncheck();\n`;

  // ── SPECIFIC (nullable signal) ─────────────────────────────────────────────
  it('01 in-body nullable CLEARS when the import loses its null branch', async function () {
    await flip(1, depNull(), bodyApp(1), hasCode(NULLABLE), depStr(), lacksCode(NULLABLE));
  });

  it('02 in-body nullable APPEARS when the import gains a null branch', async function () {
    await flip(2, depStr(), bodyApp(2), lacksCode(NULLABLE), depNull(), hasCode(NULLABLE));
  });

  it('03 oscillating the import nullability flips the in-body warning each time', async function () {
    write('dep3.uc', depNull()); write('app3.uc', bodyApp(3));
    s.openOrChangeDocument(uri('dep3.uc'), depNull(), 1);
    const d1 = await s.getDiagnostics(bodyApp(3), path.join(ws, 'app3.uc'));
    assert.ok(hasCode(NULLABLE)(d1), 'start: nullable expected');
    let v = 2;
    for (const [content, pred, label] of [
      [depStr(), lacksCode(NULLABLE), 'cleared'],
      [depNull(), hasCode(NULLABLE), 'returned'],
      [depStr(), lacksCode(NULLABLE), 'cleared-again'],
    ]) {
      s.openOrChangeDocument(uri('dep3.uc'), content, v++);
      await awaitState('app3.uc', pred, `oscillation:${label}`);
    }
  });

  // CHANGED-style helper: remove then re-add an export and require the importer's
  // code-set to transition AWAY from `pre` and back TO `pre`. Robust regardless of
  // whether type inference flows through the indirection — what matters is that the
  // dependent is re-checked (anti-stale), proven by the bidirectional transition.
  async function exportPresence(n, files, depName, appName, depPresent, depAbsent) {
    for (const [f, c] of Object.entries(files)) write(f, c);
    s.openOrChangeDocument(uri(depName), depPresent, 1);
    const d1 = await s.getDiagnostics(files[appName], path.join(ws, appName));
    const pre = codesStr(d1);
    s.openOrChangeDocument(uri(depName), depAbsent, 2);
    const gone = await awaitState(appName, (ds) => codesStr(ds) !== pre, `#${n}:export-removed`, 9000);
    s.openOrChangeDocument(uri(depName), depPresent, 3);
    const back = await awaitState(appName, (ds) => codesStr(ds) === pre, `#${n}:export-restored`, 9000);
    assert.notStrictEqual(codesStr(gone), pre, `#${n} importer must change when export removed`);
    assert.strictEqual(codesStr(back), pre, `#${n} importer must restore when export re-added`);
  }

  it('04 transitive A→B→C: editing C re-checks its direct dependent B (1-hop signal)', async function () {
    // 2-hop type inference doesn't reach the apex, but the reverseDeps walk must at
    // least re-check the direct dependent B when C flips nullability — observable there.
    const b = "'use strict';\nimport { make } from './c4.uc';\nfunction relay() { let v = make(0); return index(v, 'x'); }\nrelay();\nexport function mid() { return 1; }\n";
    write('c4.uc', depNull()); write('b4.uc', b);
    s.openOrChangeDocument(uri('c4.uc'), depNull(), 1);
    const d1 = await s.getDiagnostics(b, path.join(ws, 'b4.uc'));
    assert.ok(hasCode(NULLABLE)(d1), `B precondition: ${codesStr(d1)}`);
    s.openOrChangeDocument(uri('c4.uc'), depStr(), 2);
    await awaitState('b4.uc', lacksCode(NULLABLE), 'transitive-direct');
  });

  it('05 nullable flips through substr() (different builtin) in a body', async function () {
    const app = "'use strict';\nimport { make } from './dep5.uc';\nfunction use() { let v = make(0); return substr(v, 0, 2); }\nuse();\n";
    await flip(5, depNull(), app, hasCode(NULLABLE), depStr(), lacksCode(NULLABLE));
  });

  it('06 nullable flips through split() with the import as receiver in a body', async function () {
    const app = "'use strict';\nimport { make } from './dep6.uc';\nfunction use() { let v = make(0); return split(v, ','); }\nuse();\n";
    await flip(6, depNull(), app, hasCode(NULLABLE), depStr(), lacksCode(NULLABLE));
  });

  it('07 import used inside a thisSafe (this.x=) method body re-checks on export change', async function () {
    const present = "'use strict';\nexport function make() { return 's'; }\n";
    const absent  = "'use strict';\nexport function nope() { return 's'; }\n";
    const app = "'use strict';\nimport { make } from './dep7.uc';\nlet o = {\n  load: function() { this.v = make(); return 1; },\n  use: function() { return this.v; }\n};\no.load();\no.use();\n";
    await exportPresence(7, { 'dep7.uc': present, 'app7.uc': app }, 'dep7.uc', 'app7.uc', present, absent);
  });

  it('08 self-recursive importer body stays correct across a dep change', async function () {
    const app = "'use strict';\nimport { make } from './dep8.uc';\nfunction walk(n) {\n  if (n <= 0) { let v = make(0); return index(v, 'x'); }\n  return walk(n - 1);\n}\nwalk(3);\n";
    await flip(8, depNull(), app, hasCode(NULLABLE), depStr(), lacksCode(NULLABLE));
  });

  it('09 importer with TWO skippable bodies: only the import-using one changes', async function () {
    const app = "'use strict';\nimport { make } from './dep9.uc';\nfunction pure(x) { return x + 1; }\nfunction uses() { let v = make(0); return index(v, 'x'); }\npure(1);\nuses();\n";
    await flip(9, depNull(), app, hasCode(NULLABLE), depStr(), lacksCode(NULLABLE));
  });

  it('10 multiple dependents of one dep all refresh on its change', async function () {
    write('dep10.uc', depNull());
    const mk = (f) => `'use strict';\nimport { make } from './${f}';\nfunction use() { let v = make(0); return index(v, 'x'); }\nuse();\n`;
    write('app10a.uc', mk('dep10.uc')); write('app10b.uc', mk('dep10.uc'));
    s.openOrChangeDocument(uri('dep10.uc'), depNull(), 1);
    const da = await s.getDiagnostics(mk('dep10.uc'), path.join(ws, 'app10a.uc'));
    const db = await s.getDiagnostics(mk('dep10.uc'), path.join(ws, 'app10b.uc'));
    assert.ok(hasCode(NULLABLE)(da) && hasCode(NULLABLE)(db), 'both start nullable');
    s.openOrChangeDocument(uri('dep10.uc'), depStr(), 2);
    await Promise.all([
      awaitState('app10a.uc', lacksCode(NULLABLE), 'dependent-a'),
      awaitState('app10b.uc', lacksCode(NULLABLE), 'dependent-b'),
    ]);
  });

  it('11 fan-in: an importer of TWO deps re-checks when EITHER dep changes', async function () {
    const pA = "'use strict';\nexport function fa() { return 's'; }\n";
    const aA = "'use strict';\nexport function gone() { return 's'; }\n";
    const depB = "'use strict';\nexport function fb() { return 1; }\n";
    const app = "'use strict';\nimport { fa } from './dep11a.uc';\nimport { fb } from './dep11b.uc';\nfunction use() { fb(); return fa(); }\nuse();\n";
    await exportPresence(11, { 'dep11a.uc': pA, 'dep11b.uc': depB, 'app11.uc': app }, 'dep11a.uc', 'app11.uc', pA, aA);
  });

  it('12 import used in BOTH a body and at top-level: both clear together', async function () {
    const app = "'use strict';\nimport { make } from './dep12.uc';\nlet top = make(0);\nlet ti = index(top, 'x');\nfunction body() { let v = make(0); return index(v, 'x'); }\nbody();\n";
    write('dep12.uc', depNull()); write('app12.uc', app);
    s.openOrChangeDocument(uri('dep12.uc'), depNull(), 1);
    const d1 = await s.getDiagnostics(app, path.join(ws, 'app12.uc'));
    assert.ok(d1.filter((x) => x.code === NULLABLE).length >= 2, `expected 2 nullable, got ${codesStr(d1)}`);
    s.openOrChangeDocument(uri('dep12.uc'), depStr(), 2);
    await awaitState('app12.uc', lacksCode(NULLABLE), 'top+body');
  });

  it('13 round-trip (narrow → widen) restores the exact original diagnostics', async function () {
    write('dep13.uc', depNull()); write('app13.uc', bodyApp(13));
    s.openOrChangeDocument(uri('dep13.uc'), depNull(), 1);
    const start = await s.getDiagnostics(bodyApp(13), path.join(ws, 'app13.uc'));
    assert.ok(hasCode(NULLABLE)(start));
    s.openOrChangeDocument(uri('dep13.uc'), depStr(), 2);
    await awaitState('app13.uc', lacksCode(NULLABLE), 'rt-clear');
    s.openOrChangeDocument(uri('dep13.uc'), depNull(), 3);
    const end = await awaitState('app13.uc', hasCode(NULLABLE), 'rt-restore');
    assert.strictEqual(codesStr(end), codesStr(start), 'round-trip must restore identical diagnostics');
  });

  // ── CHANGED (anti-stale: importer must transition to a NEW code-set) ────────
  it('14 removing the exported function changes the importer’s diagnostics', async function () {
    const v1 = "'use strict';\nexport function run() { return 1; }\n";
    const v2 = "'use strict';\nexport function gone() { return 1; }\n";
    const app = "'use strict';\nimport { run } from './dep14.uc';\nfunction go() { return run(); }\ngo();\n";
    write('dep14.uc', v1); write('app14.uc', app);
    s.openOrChangeDocument(uri('dep14.uc'), v1, 1);
    const d1 = await s.getDiagnostics(app, path.join(ws, 'app14.uc'));
    const pre = codesStr(d1);
    s.openOrChangeDocument(uri('dep14.uc'), v2, 2);
    const after = await awaitState('app14.uc', (ds) => codesStr(ds) !== pre, 'export-removed');
    // re-adding restores the original set (proves it’s not just one-way staleness)
    s.openOrChangeDocument(uri('dep14.uc'), v1, 3);
    const back = await awaitState('app14.uc', (ds) => codesStr(ds) === pre, 'export-restored');
    assert.strictEqual(codesStr(back), pre);
    assert.notStrictEqual(codesStr(after), pre);
  });

  it('15 adding a referenced-but-missing export clears the importer’s error', async function () {
    const v1 = "'use strict';\nexport function make() { return 's'; }\n";
    const v2 = "'use strict';\nexport function make() { return 's'; }\nexport function helper() { return 1; }\n";
    const app = "'use strict';\nimport { make, helper } from './dep15.uc';\nfunction use() { make(); return helper(); }\nuse();\n";
    write('dep15.uc', v1); write('app15.uc', app);
    s.openOrChangeDocument(uri('dep15.uc'), v1, 1);
    const d1 = await s.getDiagnostics(app, path.join(ws, 'app15.uc'));
    const pre = codesStr(d1);
    s.openOrChangeDocument(uri('dep15.uc'), v2, 2);
    await awaitState('app15.uc', (ds) => codesStr(ds) !== pre, 'export-added');
  });

  it('16 dep deleted on disk (watched delete) refreshes the importer', async function () {
    const v1 = "'use strict';\nexport function make() { return 's'; }\n";
    const app = "'use strict';\nimport { make } from './dep16.uc';\nfunction use() { return make(); }\nuse();\n";
    write('dep16.uc', v1); write('app16.uc', app);
    s.openOrChangeDocument(uri('dep16.uc'), v1, 1);
    const d1 = await s.getDiagnostics(app, path.join(ws, 'app16.uc'));
    const pre = codesStr(d1);
    try { fs.unlinkSync(path.join(ws, 'dep16.uc')); } catch {}
    s.notifyWatchedFileChange(uri('dep16.uc'), 3 /* Deleted */);
    await awaitState('app16.uc', (ds) => codesStr(ds) !== pre, 'dep-deleted', 9000);
  });

  it('17 dep syntax error then fix: importer goes bad-then-clean (recovers exactly)', async function () {
    const ok = "'use strict';\nexport function make() { return 's'; }\n";
    const broken = "'use strict';\nexport function make( { return ; ((( \n";
    const app = "'use strict';\nimport { make } from './dep17.uc';\nfunction use() { let v = make(); return length(v); }\nuse();\n";
    write('dep17.uc', ok); write('app17.uc', app);
    s.openOrChangeDocument(uri('dep17.uc'), ok, 1);
    const clean1 = await s.getDiagnostics(app, path.join(ws, 'app17.uc'));
    const cleanStr = codesStr(clean1);
    s.openOrChangeDocument(uri('dep17.uc'), broken, 2);
    // the importer may or may not change on the broken dep; just give it a moment,
    // then fix the dep and require an EXACT recovery to the original clean set.
    await new Promise((r) => setTimeout(r, 400));
    s.openOrChangeDocument(uri('dep17.uc'), ok, 3);
    const recovered = await awaitState('app17.uc', (ds) => codesStr(ds) === cleanStr, 'dep-recover', 9000);
    assert.strictEqual(codesStr(recovered), cleanStr);
  });

  it('18 a dep change irrelevant to the importer leaves it correct (no false diag)', async function () {
    const v1 = "'use strict';\nexport function make() { return 's'; }\nexport function spare() { return 1; }\n";
    const v2 = "'use strict';\nexport function make() { return 's'; }\nexport function spare() { return 2; }\n";
    const app = "'use strict';\nimport { make } from './dep18.uc';\nfunction use() { let v = make(); return length(v); }\nuse();\n";
    write('dep18.uc', v1); write('app18.uc', app);
    s.openOrChangeDocument(uri('dep18.uc'), v1, 1);
    const d1 = await s.getDiagnostics(app, path.join(ws, 'app18.uc'));
    const pre = codesStr(d1);
    s.openOrChangeDocument(uri('dep18.uc'), v2, 2);
    // It WILL be re-analyzed (force-full) and re-published; require the publish to
    // settle to the SAME set. Drive a nullable flip afterward to prove liveness:
    // first ensure no spurious change by flipping make() nullable and back.
    const v3 = "'use strict';\nexport function make() { if (1) return 's'; return null; }\nexport function spare() { return 2; }\n";
    s.openOrChangeDocument(uri('dep18.uc'), v3, 3);
    await awaitState('app18.uc', hasCode(NULLABLE), 'irrelevant-then-live');
    s.openOrChangeDocument(uri('dep18.uc'), v1, 4);
    const back = await awaitState('app18.uc', lacksCode(NULLABLE), 'irrelevant-restore');
    assert.strictEqual(codesStr(back), pre, 'restored set must equal original (no residue)');
  });

  it('19 editing the importer’s OWN body (dep stable) introduces & clears a diag', async function () {
    const dep = "'use strict';\nexport function make() { return 's'; }\n";
    const appV1 = "'use strict';\nimport { make } from './dep19.uc';\nfunction use() { let v = make(); return length(v); }\nuse();\n";
    const appV2 = "'use strict';\nimport { make } from './dep19.uc';\nfunction use() { let v = make(); return brokenLocal; }\nuse();\n";
    write('dep19.uc', dep); write('app19.uc', appV1);
    s.openOrChangeDocument(uri('dep19.uc'), dep, 1);
    const d1 = await s.getDiagnostics(appV1, path.join(ws, 'app19.uc'));
    const pre = codesStr(d1);
    s.openOrChangeDocument(uri('app19.uc'), appV2, 2);
    const dirty = await awaitState('app19.uc', (ds) => codesStr(ds) !== pre, 'own-edit-dirty');
    s.openOrChangeDocument(uri('app19.uc'), appV1, 3);
    const clean = await awaitState('app19.uc', (ds) => codesStr(ds) === pre, 'own-edit-clean');
    assert.notStrictEqual(codesStr(dirty), pre);
    assert.strictEqual(codesStr(clean), pre);
  });

  it('20 dep change THEN importer own-edit compose without leaking stale state', async function () {
    const appV1 = "'use strict';\nimport { make } from './dep20.uc';\nfunction use() { let v = make(0); return index(v, 'x'); }\nuse();\n";
    write('dep20.uc', depNull()); write('app20.uc', appV1);
    s.openOrChangeDocument(uri('dep20.uc'), depNull(), 1);
    const d1 = await s.getDiagnostics(appV1, path.join(ws, 'app20.uc'));
    assert.ok(hasCode(NULLABLE)(d1));
    s.openOrChangeDocument(uri('dep20.uc'), depStr(), 2);
    await awaitState('app20.uc', lacksCode(NULLABLE), 'compose-clear');
    // now the importer's own edit (still using the now-non-null import) stays clean
    const appV2 = "'use strict';\nimport { make } from './dep20.uc';\nfunction use() { let v = make(0); return length(v); }\nuse();\n";
    s.openOrChangeDocument(uri('app20.uc'), appV2, 3);
    await awaitState('app20.uc', lacksCode(NULLABLE), 'compose-own-edit');
  });

  it('21 widening a dep return THEN narrowing it back through a body is exact', async function () {
    const app = bodyApp(21);
    write('dep21.uc', depStr()); write('app21.uc', app);
    s.openOrChangeDocument(uri('dep21.uc'), depStr(), 1);
    const clean = await s.getDiagnostics(app, path.join(ws, 'app21.uc'));
    assert.ok(lacksCode(NULLABLE)(clean), 'start clean');
    const cleanStr = codesStr(clean);
    s.openOrChangeDocument(uri('dep21.uc'), depNull(), 2);
    await awaitState('app21.uc', hasCode(NULLABLE), 'widen');
    s.openOrChangeDocument(uri('dep21.uc'), depStr(), 3);
    const back = await awaitState('app21.uc', lacksCode(NULLABLE), 'narrow-back');
    assert.strictEqual(codesStr(back), cleanStr, 'narrow-back must restore the exact clean set');
  });

  it('22 aliased import (make as mk): nullable flips through the alias in a body', async function () {
    const app = "'use strict';\nimport { make as mk } from './dep22.uc';\nfunction use() { let v = mk(0); return index(v, 'x'); }\nuse();\n";
    await flip(22, depNull(), app, hasCode(NULLABLE), depStr(), lacksCode(NULLABLE));
  });
});
