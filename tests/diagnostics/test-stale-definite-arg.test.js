// Second look for DEFINITE argument-type-mismatch errors (the found "tripping
// examples" of the mid-pass partial-history hazard): the main pass emitted
// `Function 'rtrim' expects string, got null` for a loop read-before-write,
// because the loop's later write wasn't recorded yet. The emit sites now attach
// the operand + at-emit members (data.staleTypeArg); the post-analysis filter
// re-resolves against complete history and DOWNGRADES to the standard may-be
// nullable-argument form when the type grew a member the function accepts.
// Claims no back edge can rescue keep their hard error.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(120000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());
async function diags(code) {
  return server.getDiagnostics(code, `/tmp/test-stale-arg-${n++}.uc`);
}
const argDiags = (d) => d.filter(x => x.code === 'UC2004' || String(x.code) === 'nullable-argument'
  || String(x.code) === 'incompatible-function-argument');

function expectDowngraded(d, fnName) {
  const hits = argDiags(d);
  expect(hits.length).toBe(1);
  expect(hits[0].severity).toBe(2); // warning
  expect(String(hits[0].code)).toBe('nullable-argument');
  expect(hits[0].message).toContain(`of ${fnName}() may be`);
}
function expectHardError(d, code = 'UC2004') {
  const hits = argDiags(d);
  expect(hits.length).toBe(1);
  expect(hits[0].severity).toBe(1);
  expect(String(hits[0].code)).toBe(code);
}

// ── downgraded: the back edge delivers a compatible value ─────────────────────

test('rtrim(read-before-write) downgrades to a may-be-null warning', async () => {
  expectDowngraded(await diags(
    'let buf;\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(buf));\n    buf = "x  ";\n}\n'), 'rtrim');
});

test('split() subject downgrades the same way', async () => {
  expectDowngraded(await diags(
    'let line;\nfor (let i = 0; i < 2; i++) {\n    print(split(line, ","));\n    line = "a,b";\n}\n'), 'split');
});

test('printf() format downgrades', async () => {
  expectDowngraded(await diags(
    'let fmt;\nfor (let i = 0; i < 2; i++) {\n    printf(fmt, i);\n    fmt = "%d\\n";\n}\n'), 'printf');
});

test('a MEMBER argument downgrades via propertyTypeAt', async () => {
  expectDowngraded(await diags(
    'let cfg = { text: null };\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(cfg.text));\n    cfg.text = "hi ";\n}\n'), 'rtrim');
});

test('timelocal() (expects object) downgrades when an object write joins', async () => {
  expectDowngraded(await diags(
    'let stamp;\nfor (let i = 0; i < 2; i++) {\n    print(timelocal(stamp));\n    stamp = { year: 2026 };\n}\n'), 'timelocal');
});

test('a write delivered through an in-loop closure call still downgrades', async () => {
  expectDowngraded(await diags(
    'let held;\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(held));\n    let fill = function() { held = "v"; };\n    fill();\n}\n'), 'rtrim');
});

test('the write may be conditional — union still rescues the definite claim', async () => {
  expectDowngraded(await diags(
    'let rare;\nfor (let i = 0; i < 3; i++) {\n    print(rtrim(rare));\n    if (i == 2)\n        rare = "last";\n}\n'), 'rtrim');
});

test('two null args in one call: both downgrade (no stray hard error left)', async () => {
  const d = await diags(
    'let sub;\nlet sep;\nfor (let i = 0; i < 2; i++) {\n    print(split(sub, sep));\n    sub = "a,b";\n    sep = ",";\n}\n');
  const hits = argDiags(d);
  expect(hits.length).toBe(2);
  for (const h of hits) expect(h.severity).toBe(2);
});

test('under `use strict` the downgrade keeps ERROR severity with the may-be form', async () => {
  const d = await diags(
    "'use strict';\nlet sbuf;\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(sbuf));\n    sbuf = \"x\";\n}\n");
  const hits = argDiags(d);
  expect(hits.length).toBe(1);
  expect(hits[0].severity).toBe(1); // strict escalates, matching the direct-emit path
  expect(String(hits[0].code)).toBe('nullable-argument');
  expect(hits[0].message).toContain('may be');
});

test('a JSDoc-typed USER function param downgrades via the generic checker path', async () => {
  const d = await diags(
    '/**\n * @param {string} needle\n */\nfunction seek(needle) {\n    return index("haystack", needle);\n}\nlet target;\nfor (let i = 0; i < 2; i++) {\n    seek(target);\n    target = "hay";\n}\n');
  const hits = d.filter(x => x.severity === 1);
  expect(hits).toEqual([]); // no definite-mismatch hard error survives
});

// ── kept: no back edge can rescue these ───────────────────────────────────────

test('KEPT: straight-line null arg with no loop', async () => {
  expectHardError(await diags(
    'let plain;\nprint(rtrim(plain));\nplain = "late";\nprint(plain);\n'));
});

test('KEPT: the only write lives in a LATER sibling loop', async () => {
  expectHardError(await diags(
    'let gap;\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(gap));\n}\nfor (let j = 0; j < 2; j++) {\n    gap = "x";\n}\n'));
});

test('KEPT: the loop write is a STILL-WRONG type (array cannot rescue rtrim)', async () => {
  const d = await diags(
    'let wrong;\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(wrong));\n    wrong = [ i ];\n}\n');
  const hits = argDiags(d);
  expect(hits.length).toBe(1);
  expect(hits[0].severity).toBe(1); // still definitely not a string
});

test('KEPT: a dominated re-null before the read (definite every iteration)', async () => {
  expectHardError(await diags(
    'let renull;\nfor (let i = 0; i < 2; i++) {\n    renull = null;\n    print(rtrim(renull));\n}\n'));
});

test('KEPT: a NAMED writer function that is never called', async () => {
  // Named declarations carry the usedAt gate: nothing references wouldFill at
  // or before the read, so its write provably has not run — the hard error stays.
  expectHardError(await diags(
    'let never;\nfunction wouldFill() {\n    never = "v";\n}\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(never));\n}\n'));
});

test('an uncalled LET-BOUND lambda writer downgrades (documented conservative)', async () => {
  // Let-bound lambdas have no body frame, so their writes union in
  // unconditionally — the filter sees `null | string` and softens the claim
  // even though the lambda never runs. Same pinned asymmetry as the
  // fresh-reference corners suite; a future body-frame for lambdas would
  // restore the hard error deliberately.
  expectDowngraded(await diags(
    'let never2;\nlet wouldFill2 = function() { never2 = "v"; };\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(never2));\n}\nprint(type(wouldFill2));\n'), 'rtrim');
});
