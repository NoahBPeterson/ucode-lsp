// `for (x in array<T> | null)` binds `x` to `T` (union-aware) — for-in over null is a
// no-op (verified vs the interpreter), so the nullable-array shape from fs.lsdir/split/…
// no longer leaves the loop variable `unknown`. Object keys / string chars stay `string`;
// a genuinely uniterable/unknown member still yields `unknown` (no false element type).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const errs = async (code) => (await server.getDiagnostics(code, `/tmp/fiu-${n++}.uc`) || []).filter((x) => x.severity === 1);
async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/fiu-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}

// ── The core fix: array<string> | null element → string ──────────────────────
test('01 for-in over `fs.lsdir()` (array<string>|null) binds a string element', async () => {
  const code = 'import * as fs from "fs";\nfunction f(d){ let cols = fs.lsdir(d); for (let col in cols) { let x = col; } }\n';
  expect(await typeOf(code, 'x = col')).toContain('string');
});
test('02 the match() use-case type-checks (no false unknown-arg)', async () => {
  const code = 'import * as fs from "fs";\nfunction f(d){ let cols = fs.lsdir(d); for (let col in cols) { if (match(col, /\\.uc$/)) print(col); } }\n';
  const m = (await errs(code)).map((d) => d.message);
  expect(m.some((x) => /Argument 1 of match/.test(x) || /\bunknown\b/i.test(x))).toBe(false);
});
test('03 bare-iterator form (no `let`) over a nullable array binds a string', async () => {
  const code = 'import * as fs from "fs";\nfunction f(d){ let cols = fs.lsdir(d); for (col in cols) { let x = col; } }\n';
  expect(await typeOf(code, 'x = col')).toContain('string');
});

// ── Preserved behavior ───────────────────────────────────────────────────────
test('04 plain (non-null) array<string> still binds string', async () => {
  expect(await typeOf('let arr = ["a","b"]; for (let e in arr) { let x = e; }\n', 'x = e')).toContain('string');
});
test('05 object keys are still string', async () => {
  expect(await typeOf('let o = { a: 1, b: 2 }; for (let k in o) { let x = k; }\n', 'x = k')).toContain('string');
});
test('06 string chars are still string', async () => {
  expect(await typeOf('for (let c in "abc") { let x = c; }\n', 'x = c')).toContain('string');
});

// ── Two-variable form: value is the array element (object values are NOT string) ──
test('07 `for (i, v in array<string>)` → v is string', async () => {
  expect(await typeOf('let arr = ["a","b"]; for (let i, v in arr) { let x = v; }\n', 'x = v')).toContain('string');
});
test('08 `for (k, v in object)` → v stays unknown (not wrongly string)', async () => {
  expect(await typeOf('let o = { a: 1 }; for (let k, v in o) { let x = v; }\n', 'x = v')).not.toContain('string');
});

// ── Conservative: uniterable/unknown member → unknown (no invented element) ───
test('09 for-in over an unknown value yields an unknown element', async () => {
  expect(await typeOf('function f(thing){ for (let e in thing) { let x = e; } }\n', 'x = e')).toContain('unknown');
});
