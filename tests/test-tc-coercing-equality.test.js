// UC2015 (coercing `==`) + extended UC2009 (impossible loose `==`).
//
// ucode `==`/`!=` is the RELATIONAL comparison (ucv_compare), NOT strict — it
// coerces both sides via ucv_to_number (ucode/types.c:2199). `===`/`!==` are
// strict (uc_vm_test_strict_equality bails on distinct types). So for a `==`
// between provably-distinct scalar types:
//   - coercion can't match (e.g. `5 == "baz"`: "baz"→NaN) → always-false, UC2009 error
//   - matches only via coercion (e.g. `5 == "5"`: 5=="5" is true) → UC2015 warning
//   - a pure numeric pair (int vs double) is left alone (== is the correct compare)
// Impossible strict `===` (obj === "baz", int === "baz") already errored — unchanged.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function codes(src) {
  const ds = await server.getDiagnostics(src, `/tmp/tc-eq-${n++}.uc`);
  return ds.filter(d => d.code === 'UC2015' || d.code === 'UC2009')
           .map(d => ({ code: String(d.code), sev: d.severity, msg: d.message }));
}
const has = (arr, code) => arr.find(d => d.code === code);

// --- UC2015: == coerces (diverges from ===) ---
test('int == numeric-string → UC2015 warning', async () => {
  const c = await codes('let n = 5;\nlet r = (n == "5");\n');
  expect(has(c, 'UC2015')).toBeTruthy();
  expect(has(c, 'UC2015').sev).toBe(2);            // Warning
});
test('int == float-string → UC2015', async () => {
  expect(has(await codes('let n = 5;\nlet r = (n == "5.5");\n'), 'UC2015')).toBeTruthy();
});
test('int == boolean → UC2015 (bool coerces to 0/1)', async () => {
  expect(has(await codes('let n = 5;\nlet r = (n == true);\n'), 'UC2015')).toBeTruthy();
});
test('boolean == 1 → UC2015 (possible via coercion)', async () => {
  expect(has(await codes('let b = true;\nlet r = (b == 1);\n'), 'UC2015')).toBeTruthy();
});
test('string == number → UC2015 (a string could coerce)', async () => {
  expect(has(await codes('let s = "x";\nlet r = (s == 5);\n'), 'UC2015')).toBeTruthy();
});

// --- UC2009 (error): loose == that can't match even with coercion ---
test('int == non-numeric-string → UC2009 error (always false)', async () => {
  const c = await codes('let n = 5;\nlet r = (n == "baz");\n');
  expect(has(c, 'UC2009')).toBeTruthy();
  expect(has(c, 'UC2009').sev).toBe(1);            // Error
});
test('boolean == 5 → UC2009 error (bool is only 0/1)', async () => {
  expect(has(await codes('let b = true;\nlet r = (b == 5);\n'), 'UC2009')).toBeTruthy();
});

// --- impossible strict === (unchanged) ---
test('obj === "baz" → UC2009 error', async () => {
  expect(has(await codes('let o = { a: 1 };\nlet r = (o === "baz");\n'), 'UC2009')).toBeTruthy();
});
test('int === "baz" → UC2009 error', async () => {
  expect(has(await codes('let n = 5;\nlet r = (n === "baz");\n'), 'UC2009')).toBeTruthy();
});

// --- SILENT cases (must NOT fire) ---
test('int == 5.0 (both numeric) → nothing (== is the correct value compare)', async () => {
  expect(await codes('let n = 5;\nlet r = (n == 5.0);\n')).toEqual([]);
});
test('same-type == → nothing', async () => {
  expect(await codes('let n = 5;\nlet m = 6;\nlet r = (n == m);\n')).toEqual([]);
});
test('unknown == literal → nothing (not confident)', async () => {
  expect(await codes('function f(x) { return x == 5; }\nlet e = f;\n')).toEqual([]);
});

// ── Literal-value refinement (value matters, not just type) ──────────────────
// A scalar literal's exact value decides coerce-match, splitting warn from error.

test('int == numeric string literal → UC2015; non-numeric → UC2009', async () => {
  expect(has(await codes('let n=5;\nlet r=(n == "5");\n'), 'UC2015')).toBeTruthy();
  expect(has(await codes('let n=5;\nlet r=(n == "5.5");\n'), 'UC2015')).toBeTruthy();
  expect(has(await codes('let n=5;\nlet r=(n == "0x1f");\n'), 'UC2015')).toBeTruthy();   // hex string is numeric
  expect(has(await codes('let n=5;\nlet r=(n == "baz");\n'), 'UC2009')).toBeTruthy();
  expect(has(await codes('let n=5;\nlet r=(n == "3px");\n'), 'UC2009')).toBeTruthy();     // trailing garbage → NaN
});
test('bool == number/string literal: 0/1 coerce (UC2015), else impossible (UC2009)', async () => {
  expect(has(await codes('let b=true;\nlet r=(b == 1);\n'), 'UC2015')).toBeTruthy();
  expect(has(await codes('let b=true;\nlet r=(b == 0);\n'), 'UC2015')).toBeTruthy();
  expect(has(await codes('let b=true;\nlet r=(b == "1");\n'), 'UC2015')).toBeTruthy();
  expect(has(await codes('let b=true;\nlet r=(b == 5);\n'), 'UC2009')).toBeTruthy();
  expect(has(await codes('let b=true;\nlet r=(b == "baz");\n'), 'UC2009')).toBeTruthy();
});
test('literal == literal (both sides): 5 == "5" warn, 5 == "baz" error', async () => {
  expect(has(await codes('let r = (5 == "5");\n'), 'UC2015')).toBeTruthy();
  expect(has(await codes('let r = (5 == "baz");\n'), 'UC2009')).toBeTruthy();
});
test('union operand: (int|string) == numeric string is OK (could be the string); == {} is impossible', async () => {
  const un = 'function f(flag){ let x = flag ? 5 : "s"; return x';
  expect(await codes(`${un} == "5"); }\n`)).toEqual([]);          // string member could equal "5"
  expect(has(await codes(`${un} == {}); }\n`), 'UC2009')).toBeTruthy();  // int|string vs object → NaN both → impossible
});
test('x == null is NOT flagged here (owned by null-safety)', async () => {
  expect(await codes('let o = {a:1};\nlet r = (o == null);\n')).toEqual([]);
  expect(await codes('let o = {a:1};\nlet r = (o != null);\n')).toEqual([]);
});
