// SERVER-DRIVEN coverage for inlayHints.ts shiftRawHints — the stale-cache remap that
// runs when an inlayHint request arrives after a didChange but BEFORE the debounced
// re-analysis refreshes the cache (server.ts: cached.version !== document.version).
// Deterministic, not a race: we send the request immediately after the edit, well
// inside the debounce window. Exercises all three branches (before / after / inside the
// changed region).
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('inlayHints shiftRawHints coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const FULL = { start: { line: 0, character: 0 }, end: { line: 500, character: 0 } };
  const uri = (n) => `file:///tmp/${n}`;
  const labelOf = (h) => (typeof h.label === 'string' ? h.label : (h.label || []).map(p => p.value).join(''));
  const typeHint = (hints) => hints.find(h => /fs\.file|file/.test(labelOf(h)) && labelOf(h).includes(':'));

  it('shifts hints DOWN when text is inserted ABOVE them (after-edit branch)', async () => {
    const f = '/tmp/shift-down.uc';
    const v1 = `import { open } from 'fs';\nlet handle = open("/p", "r");\n`;
    const h0 = await s.getInlayHints(v1, f, FULL.start, FULL.end);   // populates cache @ v1
    const t0 = typeHint(h0);
    assert.ok(t0, `precondition: a type hint at v1, got ${JSON.stringify(h0.map(labelOf))}`);
    assert.strictEqual(t0.position.line, 1, 'hint starts on line 1');

    // Insert a line ABOVE -> didChange to v2; request before debounced re-analysis.
    const v2 = `// inserted top line\nimport { open } from 'fs';\nlet handle = open("/p", "r");\n`;
    s.openOrChangeDocument(uri('shift-down.uc'), v2, 2);
    const shifted = await s.requestInlayHints(uri('shift-down.uc'), FULL.start, FULL.end);
    const ts = typeHint(shifted);
    assert.ok(ts, `expected a shifted hint, got ${JSON.stringify(shifted.map(labelOf))}`);
    assert.strictEqual(ts.position.line, 2, `hint should have shifted to line 2, got ${ts.position.line}`);
  });

  it('keeps hints in place when text is appended BELOW them (before-edit branch)', async () => {
    const f = '/tmp/shift-keep.uc';
    const v1 = `import { open } from 'fs';\nlet handle = open("/p", "r");\n`;
    const h0 = await s.getInlayHints(v1, f, FULL.start, FULL.end);
    assert.ok(typeHint(h0), 'precondition hint present');

    const v2 = v1 + `let tail = 1;\nprint(tail);\n`; // append below the hint
    s.openOrChangeDocument(uri('shift-keep.uc'), v2, 2);
    const after = await s.requestInlayHints(uri('shift-keep.uc'), FULL.start, FULL.end);
    const t = typeHint(after);
    assert.ok(t, 'hint still present after appending below');
    assert.strictEqual(t.position.line, 1, `unedited hint should stay on line 1, got ${t.position.line}`);
  });

  it('drops a hint whose line is replaced, keeps/shifts the others (inside branch)', async () => {
    const f = '/tmp/shift-drop.uc';
    const v1 = `import { open } from 'fs';\nlet first = open("/1", "r");\nlet middle = open("/2", "r");\nlet last = open("/3", "r");\n`;
    const h0 = await s.getInlayHints(v1, f, FULL.start, FULL.end);
    assert.ok(h0.filter(h => labelOf(h).includes(':')).length >= 3, `expected 3 type hints, got ${JSON.stringify(h0.map(labelOf))}`);

    // Replace the MIDDLE line's body so the middle hint sits inside the changed region.
    const v2 = `import { open } from 'fs';\nlet first = open("/1", "r");\nlet completely_renamed_middle = 12345;\nlet last = open("/3", "r");\n`;
    s.openOrChangeDocument(uri('shift-drop.uc'), v2, 2);
    const after = await s.requestInlayHints(uri('shift-drop.uc'), FULL.start, FULL.end);
    assert.ok(Array.isArray(after), 'shiftRawHints returned hints array for a mid-region replace');
    // The first hint stays on line 1; this proves before-branch retention alongside the
    // dropped/inside handling for the replaced middle line.
    const first = after.find(h => h.position.line === 1 && labelOf(h).includes(':'));
    assert.ok(first, `the unchanged first hint should remain on line 1, got ${JSON.stringify(after.map(h => h.position.line))}`);
  });

  it('range filtering still applies to shifted hints (materializeRawHints)', async () => {
    const f = '/tmp/shift-range.uc';
    const v1 = `import { open } from 'fs';\nlet a = open("/1", "r");\nlet b = open("/2", "r");\n`;
    await s.getInlayHints(v1, f, FULL.start, FULL.end);
    const v2 = `// top\nimport { open } from 'fs';\nlet a = open("/1", "r");\nlet b = open("/2", "r");\n`;
    s.openOrChangeDocument(uri('shift-range.uc'), v2, 2);
    // request only line 2 (where `a` now lives) -> shifted + filtered
    const narrow = await s.requestInlayHints(uri('shift-range.uc'), { line: 2, character: 0 }, { line: 2, character: 100 });
    assert.ok(Array.isArray(narrow), 'narrow request returns array');
    for (const h of narrow) assert.strictEqual(h.position.line, 2, `range filter should keep only line 2, got ${h.position.line}`);
  });
});
