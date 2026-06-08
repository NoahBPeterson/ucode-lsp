// `length()` is a total, null-safe function: `length(x) > 0` / `if (!length(x))` read
// correctly for any x (`null > 0` is `false` = "empty/invalid"). So length used in a
// TEST position is a sound type-test and is NOT flagged "argument is unknown" — even
// under `'use strict'`. A bare value use (`let n = length(x)`) is still flagged, and
// builtins whose null result mis-reads in a test (index/match: `null != -1` → "found")
// stay flagged in strict. (Discussion: ucode `'use strict'` only changes
// undeclared-variable access, not a builtin's return behavior.)
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

let n = 0;
async function unknownArgFlagged(body, { strict } = {}) {
  const code = (strict ? "'use strict';\n" : '') + `function f(p) {\n${body}\n}\n`;
  const d = await server.getDiagnostics(code, `/tmp/ltc-${n++}.uc`);
  return (d || []).some((x) => /is unknown\. Use a type guard/.test(x.message || ''));
}

test('strict: length(x) in a comparison is NOT flagged', async () => {
  expect(await unknownArgFlagged('let y = length(p) > 0;', { strict: true })).toBe(false);
});

test('strict: if (!length(x)) is NOT flagged', async () => {
  expect(await unknownArgFlagged('if (!length(p)) { print(1); }', { strict: true })).toBe(false);
});

test('strict: length() inside a filter predicate is NOT flagged (the merge_arrays case)', async () => {
  expect(await unknownArgFlagged('let y = filter([], (val) => length(val) > 0);', { strict: true })).toBe(false);
});

test('strict: a bare value use of length() IS still flagged (unknown→error preserved)', async () => {
  expect(await unknownArgFlagged('let n = length(p);', { strict: true })).toBe(true);
});

test('strict: length() in arithmetic (value use) IS still flagged', async () => {
  expect(await unknownArgFlagged('let n = length(p) + 5;', { strict: true })).toBe(true);
});

test('strict: index() in a comparison IS still flagged (null != -1 mis-reads as "found")', async () => {
  expect(await unknownArgFlagged("let y = index(p, 'x') != -1;", { strict: true })).toBe(true);
});

test('strict: match() in an if IS still flagged (not a sound test idiom)', async () => {
  expect(await unknownArgFlagged('if (match(p, /re/)) { print(1); }', { strict: true })).toBe(true);
});

test('non-strict: length(x) in a comparison stays clean (unchanged)', async () => {
  expect(await unknownArgFlagged('let y = length(p) > 0;', { strict: false })).toBe(false);
});

test('the full merge_arrays filter line is clean under strict', async () => {
  const code = `'use strict';\nexport function merge_arrays(...values) {\n    values = filter(values, (val) => length(val) > 0);\n    if (!length(values)) return [];\n    return values;\n}\n`;
  const d = await server.getDiagnostics(code, `/tmp/ltc-ma.uc`);
  expect((d || []).some((x) => /is unknown\. Use a type guard/.test(x.message || ''))).toBe(false);
});
