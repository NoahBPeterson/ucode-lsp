// Narrowing `arr[i]` on a nullable array (`match()` → array<string>|null) after an early-exit
// guard. Three pieces compose: (1) a computed access on a receiver narrowed non-null + proven
// in-bounds yields the bare element type; (2) an early-exit `if (length(arr) < N) continue`
// establishes length >= N for later siblings; (3) `if (!m || …) continue` narrows m non-null
// (a `!m` disjunct of an `||` early-exit). Sound: an unproven index / a length-reducing
// mutation between guard and access keeps the `| null`.
//
// UPDATED for docs/tc-match-capture-group-typing.md + docs/tc-negative-array-index.md:
// a match() result against a REGEX LITERAL now carries a STATIC tuple shape (element
// count + per-group nullability) derived straight from the pattern — see
// tests/test-tc-match-capture-typing.test.js and tests/test-tc-negative-array-index.test.js
// for the dedicated coverage. That tuple can prove an index in-range (including a
// negative one) WITHOUT any length() guard at all, once the receiver itself is
// narrowed non-null — several cases below were updated accordingly (see the note
// above the "must STAY nullable" block). It does NOT override the "receiver may be
// null" / "mutated since assignment" soundness checks — those still apply exactly
// as before (see the `shift()`/reassignment tests).
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
test('base narrowed, no length guard, but m[0] (the full match) needs none', async () => {
  // UPDATED for docs/tc-match-capture-group-typing.md: `uc_match` (ucode/lib.c:3126)
  // always pushes the full match as element 0 on ANY successful match, so once `m`
  // is narrowed non-null (`!m` guard here), `m[0]` is statically known non-null —
  // no length() guard needed. This used to require one (index-in-bounds was only
  // provable via an explicit length() guard); now the regex-literal's static tuple
  // shape proves it directly.
  expect(await nullable("  if (!m) continue;\n  lc(m[0]);")).toBe(false);
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
// NOTE (docs/tc-match-capture-group-typing.md / tc-negative-array-index.md): the
// pattern `/(\w+) (\w+) (\w+)/` has exactly 3 capture groups, ALL mandatory (no
// `?`/`*`/`{0,}`, no alternation) — so its match-array tuple shape is *statically*
// known to be EXACTLY 4 elements (index 0 the full match, 1-3 the groups) whenever
// `m` itself is non-null. Several of these "stays nullable" cases below only
// stayed nullable in the OLD model because in-bounds-ness required an EXPLICIT
// `length(m)` guard with a provable lower bound — once `m` is narrowed non-null,
// the new static tuple makes indices 0-3 (or -1..-4) provably in range with no
// length() reasoning at all, so they've been moved to "narrows" below (16, 17, 18,
// 20). 19 is unaffected: it never narrows `m` itself non-null (no `!m` disjunct),
// so it correctly stays nullable regardless of tuple shape.
test('16 `==` guard gives no lower bound, but m is non-null (`!m` disjunct) and index 3 is a mandatory tuple slot', async () => {
  expect(await hasNull(L("  if (!m || length(m) == 4) continue;\n  lc(m[3]);"))).toBe(false);
});
test('17 `>=` guard negates to `<` → no lower bound, but m is non-null and index 2 is a mandatory tuple slot', async () => {
  expect(await hasNull(L("  if (!m || length(m) >= 4) continue;\n  lc(m[2]);"))).toBe(false);
});
test('18 negative index resolves through the tuple once m is non-null (m[-1] = last mandatory group)', async () => {
  expect(await hasNull(L("  if (!m || length(m) < 4) continue;\n  lc(m[-1]);"))).toBe(false);
});
test('19 a positive early-exit `if (length(m) >= 4) continue` proves nothing after', async () => {
  // after it, length < 4; and m's base is not narrowed (no !m) → still nullable.
  // Unaffected by the tuple fix — there's no `!m` disjunct here, so `m` itself
  // (not just an index) is never proven non-null, and the tuple can't apply to a
  // possibly-null receiver.
  expect(await hasNull(L("  if (length(m) >= 4) continue;\n  lc(m[2]);"))).toBe(true);
});
test('20 an `else` branch: control flow reaching m[2] implies the `if` was false (m non-null, index 2 mandatory)', async () => {
  // `if (COND) continue; else print('x');` — the consequent unconditionally exits, so
  // any code reached AFTER the whole if/else was only reachable via the else (COND
  // false) → `!COND` = `m && length(m) >= 4` holds. Combined with the static tuple
  // (index 2 mandatory for this pattern), `m[2]` is provably non-null.
  expect(await hasNull(L("  if (!m || length(m) < 4) continue;\n  else print('x');\n  lc(m[2]);"))).toBe(false);
});
