// Narrowing `arr[i]` on a nullable array (`match()` → array<string>|null) after an early-exit
// guard. Three pieces compose: (1) a computed access on a receiver narrowed non-null + proven
// in-bounds yields the bare element type; (2) an early-exit `if (length(arr) < N) continue`
// establishes length >= N for later siblings; (3) `if (!m || …) continue` narrows m non-null
// (a `!m` disjunct of an `||` early-exit). Sound: an unproven index / a length-reducing
// mutation between guard and access keeps the `| null`.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/mcn-${n++}.uc`;
// Does a null-requiring use of the access warn? (lc() wants a non-null string.)
async function nullable(body) {
  const code = `for (let l in ['a']) {\n  let m = match(l, /(\\w+) (\\w+) (\\w+)/);\n${body}\n}\n`;
  const d = (await server.getDiagnostics(code, uri())) || [];
  return d.some((x) => /null/.test(x.message));
}

// ── the reported idiom: capture access after `if (!m || length(m) < 4) continue;` ──
test('m[2]/m[3] are non-null after `if (!m || length(m) < 4) continue`', async () => {
  expect(await nullable("  if (!m || length(m) < 4) continue;\n  lc(m[2]);")).toBe(false);
  expect(await nullable("  if (!m || length(m) < 4) continue;\n  lc(m[3]);")).toBe(false);
});
test('if-consequent form narrows too: `if (m && length(m) > 2) lc(m[2])`', async () => {
  expect(await nullable("  if (m && length(m) > 2) { lc(m[2]); }")).toBe(false);
});

// ── soundness: only PROVEN-in-bounds indices narrow ──
test('an index at/above the proven bound stays nullable', async () => {
  expect(await nullable("  if (!m || length(m) < 4) continue;\n  lc(m[4]);")).toBe(true); // 4 < 4 is false
  expect(await nullable("  if (!m || length(m) < 4) continue;\n  lc(m[9]);")).toBe(true);
});
test('base narrowed but NO length guard → out-of-bounds keeps the null', async () => {
  expect(await nullable("  if (!m) continue;\n  lc(m[0]);")).toBe(true);
});
test('no base narrowing (m still nullable) keeps the null', async () => {
  expect(await nullable("  lc(m[0]);")).toBe(true);
});

// ── soundness: mutation between the guard and the access invalidates the bound ──
test('a shift() between the guard and the access re-nullifies (bound is stale)', async () => {
  expect(await nullable("  if (!m || length(m) < 4) continue;\n  shift(m);\n  lc(m[2]);")).toBe(true);
});
test('a reassignment of m between guard and access re-nullifies', async () => {
  expect(await nullable("  if (!m || length(m) < 4) continue;\n  m = match(l, /(.)/);\n  lc(m[2]);")).toBe(true);
});

// ── `||` RHS narrowing: `!m || length(m)` types m non-null at the length() arg (strict) ──
test('length(m) in `if (!m || length(m) < 4)` is not a false "may be null" (strict)', async () => {
  const code = "'use strict';\nfor (let l in ['a']) {\n  let m = match(l, /(\\w+)/);\n  if (!m || length(m) < 4) continue;\n}\n";
  const d = (await server.getDiagnostics(code, uri())) || [];
  expect(d.some((x) => /length\(\) may be null/.test(x.message))).toBe(false);
});

// ── an `&&` early-exit must NOT narrow (negation is a union, not m-non-null) ──
test('`if (!m && x) continue` does NOT narrow m non-null (unsound to)', async () => {
  // !(!m && x) = m || !x → m may still be null. Keep the null.
  expect(await nullable("  let x = 1;\n  if (!m && x) continue;\n  lc(m[2]);")).toBe(true);
});

// ══ 20 edge cases — distinct/strange, both soundness directions ══════════════
// `L(body)` wraps a body in a for-loop with `let m = match(l, /(\w+) (\w+) (\w+)/)`.
const L = (body) => `for (let l in ['a']) {\n  let m = match(l, /(\\w+) (\\w+) (\\w+)/);\n${body}\n}\n`;
const hasNull = async (code) => ((await server.getDiagnostics(code, uri())) || []).some((x) => /null/.test(x.message));

// ── must NARROW (non-null) ──────────────────────────────────────────────────
test('01 `<=` guard: length(m) <= 3 → length >= 4', async () => {
  expect(await hasNull(L("  if (!m || length(m) <= 3) continue;\n  lc(m[3]);"))).toBe(false);
});
test('02 flipped operand: `4 > length(m)`', async () => {
  expect(await hasNull(L("  if (!m || 4 > length(m)) continue;\n  lc(m[2]);"))).toBe(false);
});
test('03 positive if-consequent `>=`', async () => {
  expect(await hasNull(L("  if (m && length(m) >= 4) { lc(m[3]); }"))).toBe(false);
});
test('04 `break` in a while loop is an exit', async () => {
  expect(await hasNull("while (true) {\n  let m = match('a b c', /(\\w+) (\\w+) (\\w+)/);\n  if (!m || length(m) < 4) break;\n  lc(m[2]);\n}\n")).toBe(false);
});
test('05 `return` in a function is an exit', async () => {
  expect(await hasNull("function f(l) {\n  let m = match(l, /(\\w+) (\\w+) (\\w+)/);\n  if (!m || length(m) < 4) return;\n  return lc(m[2]);\n}\n")).toBe(false);
});
test('06 `die()` is an exit', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) die('bad');\n  lc(m[2]);"))).toBe(false);
});
test('07 `exit()` is an exit', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) exit(1);\n  lc(m[2]);"))).toBe(false);
});
test('08 block consequent `{ continue; }`', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) { continue; }\n  lc(m[2]);"))).toBe(false);
});
test('09 block consequent ending in continue', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) { print('skip'); continue; }\n  lc(m[2]);"))).toBe(false);
});
test('10 `!m` as the RIGHT disjunct', async () => {
  expect(await hasNull(L("  if (length(m) < 4 || !m) continue;\n  lc(m[2]);"))).toBe(false);
});
test('11 three-way `||` chain', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4 || l == '') continue;\n  lc(m[2]);"))).toBe(false);
});
test('12 two separate early-exit guards', async () => {
  expect(await hasNull(L("  if (!m) continue;\n  if (length(m) < 4) continue;\n  lc(m[2]);"))).toBe(false);
});
test('13 push() between guard and access does NOT invalidate (length grows)', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) continue;\n  push(m, 'x');\n  lc(m[2]);"))).toBe(false);
});
test('14 splice() on a DIFFERENT array does not invalidate m', async () => {
  expect(await hasNull(L("  let other = [1, 2];\n  if (!m || length(m) < 4) continue;\n  splice(other, 0);\n  lc(m[2]);"))).toBe(false);
});
test('15 access in a nested block after the guard', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) continue;\n  { lc(m[2]); }"))).toBe(false);
});

// ── must STAY nullable (soundness) ──────────────────────────────────────────
test('16 `==` guard gives no lower bound', async () => {
  expect(await hasNull(L("  if (!m || length(m) == 4) continue;\n  lc(m[3]);"))).toBe(true);
});
test('17 `>=` guard negates to `<` → no lower bound', async () => {
  expect(await hasNull(L("  if (!m || length(m) >= 4) continue;\n  lc(m[2]);"))).toBe(true);
});
test('18 negative index is never proven in bounds', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) continue;\n  lc(m[-1]);"))).toBe(true);
});
test('19 a positive early-exit `if (length(m) >= 4) continue` proves nothing after', async () => {
  // after it, length < 4; and m's base is not narrowed (no !m) → still nullable.
  expect(await hasNull(L("  if (length(m) >= 4) continue;\n  lc(m[2]);"))).toBe(true);
});
test('20 an `else` branch disables the early-exit narrowing (conservative)', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) continue;\n  else print('x');\n  lc(m[2]);"))).toBe(true);
});
