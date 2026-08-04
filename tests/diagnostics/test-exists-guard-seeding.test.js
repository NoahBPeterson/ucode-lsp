// UC8004 exists-guard seeding (docs/uc8004-exists-guard-seeding.md):
// `if (!exists(global, 'X')) global.X = v;` guarantees X exists on BOTH paths —
// either it already existed (the test says so) or we just assigned it. The
// must-assign analysis previously saw only "assigned inside a conditional branch"
// and flagged the canonical strict-mode seeding idiom. Runtime-verified: the
// guarded file runs and later reads see the value.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

const file = (n) => `/tmp/test-exists-guard-${n}.uc`;
const uc8004 = (diags) => diags.filter(d => d.code === 'UC8004');
const uc8005 = (diags) => diags.filter(d => d.code === 'UC8005');

test('the canonical seed idiom is clean, including the later read', async () => {
  const code =
    "'use strict';\n" +
    "if (!exists(global, 'REQUIRE_SEARCH_PATH'))\n" +
    '    global.REQUIRE_SEARCH_PATH = [];\n' +
    'print(global.REQUIRE_SEARCH_PATH);\n';
  const diags = await server.getDiagnostics(code, file('canonical'));
  expect(uc8004(diags)).toEqual([]);
  expect(uc8005(diags)).toEqual([]);
});

test('inverted form: if (exists(...)) {} else { assign } is clean', async () => {
  const code =
    "if (exists(global, 'CFG')) {\n" +
    '} else {\n' +
    '    global.CFG = { a: 1 };\n' +
    '}\n' +
    'print(global.CFG);\n';
  const diags = await server.getDiagnostics(code, file('inverted'));
  expect(uc8004(diags)).toEqual([]);
});

test("`exists(global, 'X') == false` and `=== false` spellings are recognized", async () => {
  const code =
    "if (exists(global, 'A') == false)\n" +
    '    global.A = 1;\n' +
    "if (exists(global, 'B') === false)\n" +
    '    global.B = 2;\n' +
    "if (false == exists(global, 'C'))\n" +
    '    global.C = 3;\n' +
    'print(global.A, global.B, global.C);\n';
  const diags = await server.getDiagnostics(code, file('boolcmp'));
  expect(uc8004(diags)).toEqual([]);
});

test('bracket-key assignment under the guard is clean', async () => {
  const code =
    "if (!exists(global, 'SEEDED'))\n" +
    "    global['SEEDED'] = 42;\n" +
    "print(global['SEEDED']);\n";
  const diags = await server.getDiagnostics(code, file('bracket'));
  expect(uc8004(diags)).toEqual([]);
});

test('a block-bodied then-arm with extra statements still proves the seed', async () => {
  const code =
    "if (!exists(global, 'STATE')) {\n" +
    '    let seed = { ready: false };\n' +
    '    global.STATE = seed;\n' +
    '}\n' +
    'print(global.STATE);\n';
  const diags = await server.getDiagnostics(code, file('block'));
  expect(uc8004(diags)).toEqual([]);
});

// ── the existing true positives must survive ──────────────────────────────────

test('MISMATCHED guard name still flags the assignment', async () => {
  const code =
    "if (!exists(global, 'OTHER'))\n" +
    '    global.TARGET = 1;\n' +
    'print(global.TARGET);\n';
  const diags = await server.getDiagnostics(code, file('mismatch'));
  expect(uc8004(diags).length).toBe(1);
  expect(uc8004(diags)[0].message).toContain('TARGET');
});

test('a VARIABLE key proves nothing — still flagged', async () => {
  const code =
    "let keyName = 'DYNAMIC';\n" +
    'if (!exists(global, keyName))\n' +
    '    global.DYNAMIC = 1;\n' +
    'print(global.DYNAMIC);\n';
  const diags = await server.getDiagnostics(code, file('varkey'));
  expect(uc8004(diags).length).toBe(1);
});

test('an unrelated condition still flags — the plain true positive stays', async () => {
  const code =
    'let cond = length(ARGV) > 0;\n' +
    'if (cond)\n' +
    '    global.MAYBE = 1;\n' +
    'print(global.MAYBE);\n';
  const diags = await server.getDiagnostics(code, file('unrelated'));
  expect(uc8004(diags).length).toBe(1);
});

test('the NON-negated bare guard does not bless the then-arm assignment', async () => {
  // `if (exists(global,'X')) global.X = 1;` — on the path where X does NOT
  // exist, nothing assigns it. Not a seed; still flagged.
  const code =
    "if (exists(global, 'GONE'))\n" +
    '    global.GONE = 1;\n' +
    'print(global.GONE);\n';
  const diags = await server.getDiagnostics(code, file('nonneg'));
  expect(uc8004(diags).length).toBe(1);
});

test('guard on X blessing arm that assigns only Y still flags Y', async () => {
  const code =
    "if (!exists(global, 'X')) {\n" +
    '    global.Y = 2;\n' +
    '}\n' +
    'print(global.Y);\n';
  const diags = await server.getDiagnostics(code, file('crossname'));
  expect(uc8004(diags).length).toBe(1);
  expect(uc8004(diags)[0].message).toContain('Y');
});
