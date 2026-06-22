// auto-docs/09: `'x' in map(...)/filter(...)/keys(...)/values(...)` on an unknown-typed arg
// false-errored "'in' operator requires object or array on right side". Those builtins return
// `array | null`, and the `in` check rejected the union (it required the WHOLE type be a
// subtype of array/object; the null broke that, and it never recognized "union contains
// array"). Bigger finding (verified vs /usr/local/bin/ucode): ucode's `in` NEVER throws — it
// returns false for ANY non-collection right side (`'x' in null/5/"s"/true` all → false). So
// `in` over a union containing array/object is a valid, null-safe membership test. Fix: accept
// any right side that CONTAINS array or object (no null guard needed); only a value that can
// NEVER be a collection (pure scalar/null) is flagged (always false, a likely mistake).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/in-coll-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const inErr = async (code) => (await errs(code)).some((m) => /'in' operator requires|'in' over a .* is always false|possibly 'null'/.test(m));

// ── The corpus repro: in over a collection-returning builtin on an unknown arg ─
test("'x' in map(unknown, …) is clean", async () => {
  expect(await inErr("function f(p) { let t = map(p.match, m => m[1]); if ('ip' in t) print('y'); }\n")).toBe(false);
});
test("'x' in filter(unknown, …) is clean", async () => {
  expect(await inErr("function f(x) { if ('a' in filter(x, m => m)) print('y'); }\n")).toBe(false);
});
test("'x' in keys(unknown) is clean", async () => {
  expect(await inErr("function f(o) { if ('a' in keys(o)) print('y'); }\n")).toBe(false);
});
test("'x' in values(unknown) is clean", async () => {
  expect(await inErr("function f(o) { if ('a' in values(o)) print('y'); }\n")).toBe(false);
});
test('the firewall4-style idiom is clean', async () => {
  const code = "function f(ipset) { let types = map(ipset.match, m => m[1]); if (('ip' in types || 'net' in types)) print('y'); }\n";
  expect(await inErr(code)).toBe(false);
});

// ── `in` over nullable / union right sides is clean (in is null-safe) ─────────
test("'x' in (array | null) is clean (no null guard required — in null → false)", async () => {
  expect(await inErr("let t = sort(keys({a:1}));\nif ('a' in t) print('y');\n")).toBe(false);
});
test("'x' in (object | null) is clean", async () => {
  expect(await inErr("function f(c) { let o = c ? {a:1} : null; if ('a' in o) print('y'); }\n")).toBe(false);
});
test("'x' in (object | array) is clean", async () => {
  expect(await inErr("function f(c) { let u = c ? {a:1} : [1]; if ('a' in u) print('y'); }\n")).toBe(false);
});

// ── Still clean for plain collections (regression) ───────────────────────────
test("'x' in a known array is clean", async () => {
  expect(await inErr("if ('a' in ['a','b']) print('y');\n")).toBe(false);
});
test("'x' in a known object is clean", async () => {
  expect(await inErr("if ('a' in {a:1}) print('y');\n")).toBe(false);
});

// ── A right side that can NEVER be a collection is still flagged (always false) ─
test("'x' in an integer is still flagged", async () => {
  expect((await errs("if ('a' in 5) print('y');\n")).some((m) => /always false/.test(m))).toBe(true);
});
test("'x' in a string variable is still flagged", async () => {
  expect((await errs("let s = \"x\";\nif ('a' in s) print('y');\n")).some((m) => /always false/.test(m))).toBe(true);
});
