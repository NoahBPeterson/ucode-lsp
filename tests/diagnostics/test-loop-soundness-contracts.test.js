// Soundness ruling 2026-08-04 (docs/type-soundness-audit.md I-3, user call):
// prefer honest unions over precise-but-wrong claims around loops.
//   1. In-loop MEMBER writes are union-only, exactly like identifiers since
//      0.7.85: a post-loop read keeps the pre-loop value alive (the loop may
//      run zero times), and sibling-branch exclusion is invalid (a previous
//      iteration's branch write survives into any later path).
//   2. Derived bindings (`let snap = x;` / `let mode = cfg.mode;`) are
//      RE-STAMPED post-analysis from the complete history — widen-only — so
//      the mid-pass partial-history stamp can no longer under-report.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(90000);

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

let fileNo = 0;
const nextFile = () => `/tmp/test-loop-sound-${fileNo++}.uc`;
async function hoverText(code, line, character) {
  const h = await server.getHover(code, nextFile(), line, character);
  return JSON.stringify(h?.contents ?? '');
}

// ── derived-binding re-stamp ──────────────────────────────────────────────────

test('a binding initialized from a pre-write in-loop read is re-stamped to the union', async () => {
  // This exact shape was the documented 0.7.92 limitation: snapshot stamped
  // `null` mid-pass. The post-analysis re-stamp widens it.
  const code =
    'let lagging;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    let snapshot = lagging;\n' +
    '    print(snapshot);\n' +
    '    lagging = 42;\n' +
    '}\n';
  const text = await hoverText(code, 2, 9); // hover `snapshot` at its declaration
  expect(text).toContain('integer');
  expect(text).toContain('null');
});

test('re-stamp chains: a copy of the derived binding widens too', async () => {
  const code =
    'let source;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    let first = source;\n' +
    '    let second = first;\n' +
    '    print(second);\n' +
    '    source = "written";\n' +
    '}\n';
  const text = await hoverText(code, 3, 9); // hover `second`
  expect(text).toContain('string');
  expect(text).toContain('null');
});

test('re-stamp is widen-only: a precise straight-line binding keeps its type', async () => {
  const code =
    'let count = 5;\n' +
    'let copyNum = count;\n' +
    'print(copyNum);\n';
  const text = await hoverText(code, 1, 5);
  expect(text).toContain('integer');
  expect(text).not.toContain('null');
});

test('a member-read derived binding widens from loop-carried member writes', async () => {
  const code =
    'let cfg = { mode: null };\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    let seen = cfg.mode;\n' +
    '    print(seen);\n' +
    '    cfg.mode = 7;\n' +
    '}\n';
  const text = await hoverText(code, 2, 9); // hover `seen`
  expect(text).toContain('integer');
  expect(text).toContain('null');
});

// ── member in-loop writes are union-only ──────────────────────────────────────

test('post-loop member read keeps the pre-loop value alive (zero-iteration path)', async () => {
  // Was a definite `integer` before the ruling — unsound: the loop body may
  // never run, leaving mode at its null baseline.
  const code =
    'let carrierObj = { mode: null };\n' +
    'for (let round = 0; round < length(ARGV); round++) {\n' +
    '    carrierObj.mode = 1;\n' +
    '}\n' +
    'let after = carrierObj.mode;\n' +
    'print(after);\n';
  const text = await hoverText(code, 4, 5); // hover `after`
  expect(text).toContain('integer');
  expect(text).toContain('null');
});

test('the rv.days shape: a dict seeded only inside a loop stays honestly nullable', async () => {
  const code =
    'let rv = { days: null };\n' +
    'for (let line in ARGV) {\n' +
    '    rv.days = {};\n' +
    '}\n' +
    'let bucket = rv.days;\n' +
    'print(bucket);\n';
  const text = await hoverText(code, 4, 5);
  expect(text).toContain('null'); // the zero-iteration path is real
  expect(text).toContain('object');
});

test('in-loop sibling-branch member write is not excluded post-loop', async () => {
  // The write sits in the if-branch; a read AFTER the loop is not "in the
  // sibling else world" — a previous iteration may have taken the if-branch.
  const code =
    'let toggle = { state: null };\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (round % 2) {\n' +
    '        toggle.state = "on";\n' +
    '    } else {\n' +
    '        print("skip\\n");\n' +
    '    }\n' +
    '}\n' +
    'let final = toggle.state;\n' +
    'print(final);\n';
  const text = await hoverText(code, 8, 5);
  expect(text).toContain('string');
  expect(text).toContain('null');
});

test('straight-line member writes still promote (no loop, no change)', async () => {
  const code =
    'let plain = { mode: null };\n' +
    'plain.mode = 3;\n' +
    'let read = plain.mode;\n' +
    'print(read);\n';
  const text = await hoverText(code, 2, 5);
  expect(text).toContain('integer');
  expect(text).not.toContain('null');
});

test('a read INSIDE the loop after the member write still unions (iteration 1 vs 2)', async () => {
  // Within one iteration the write dominates textually, but the value from the
  // PREVIOUS iteration's paths flows in via the back edge; the union is the
  // honest answer either way because the walk cannot distinguish iterations.
  const code =
    'let cell = { value: null };\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    cell.value = round;\n' +
    '    let now = cell.value;\n' +
    '    print(now);\n' +
    '}\n';
  const text = await hoverText(code, 3, 9);
  expect(text).toContain('integer');
});
