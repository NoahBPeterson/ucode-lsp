// Exhaustive matrix (50 cases) for filter() as a type-narrowing construct:
// `filter(arr, (x) => GUARD(x))` keeps only elements GUARD accepts, so the result's
// element type is GUARD applied to the input element type. Reuses the same
// positive-branch guard engine as if-consequents (type()/truthy/!=null narrow;
// length()/numeric/opaque predicates do not). map()/sort() are NOT narrowed.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });
const uri = () => `/tmp/fnm-${n++}.uc`;

const clean = (h) => {
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/[\s\S]*\*\*[A-Za-z0-9_$]+\*\*:\s*/, '').replace(/`/g, '').split('\n')[0].trim();
};
// result element type of `let r = <call>` with a rest-param `arr` (array<unknown>)
async function restR(call) {
  const code = `function f(...arr) {\n    let r = ${call};\n}\n`;
  return clean(await server.getHover(code, uri(), 1, 8));
}
// ... with a typed array literal on the line above
async function typedR(lit, call) {
  const code = `function f() {\n    let arr = ${lit};\n    let r = ${call};\n}\n`;
  return clean(await server.getHover(code, uri(), 2, 8));
}
async function errs(code) {
  return (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
}
const F = (pred) => `filter(arr, ${pred})`;

// ── A. Recognized type() guard forms (base element = unknown) ────────────────
test('01 type=="string"  → array<string>',   async () => expect(await restR(F('(x) => type(x) == "string"'))).toBe('array<string>'));
test('02 type=="array"   → array<array>',     async () => expect(await restR(F('(x) => type(x) == "array"'))).toBe('array<array>'));
test('03 type=="object"  → array<object>',    async () => expect(await restR(F('(x) => type(x) == "object"'))).toBe('array<object>'));
test('04 type=="int"     → array<integer>',   async () => expect(await restR(F('(x) => type(x) == "int"'))).toBe('array<integer>'));
test('05 type=="double"  → array<double>',    async () => expect(await restR(F('(x) => type(x) == "double"'))).toBe('array<double>'));
test('06 type=="bool"    → array<boolean>',   async () => expect(await restR(F('(x) => type(x) == "bool"'))).toBe('array<boolean>'));
test('07 OR str||array   → array<string | array>',  async () => expect(await restR(F('(x) => type(x) == "string" || type(x) == "array"'))).toBe('array<string | array>'));
test('08 triple OR       → array<string | array | object>', async () => expect(await restR(F('(x) => type(x) == "string" || type(x) == "array" || type(x) == "object"'))).toBe('array<string | array | object>'));
test('09 != on unknown base → no change (array)', async () => expect(await restR(F('(x) => type(x) != "string"'))).toBe('array'));
test('10 truthy x on unknown base → no change (array)', async () => expect(await restR(F('(x) => x'))).toBe('array'));

// ── B. Narrowing against a typed input element ──────────────────────────────
test('11 [a,b] (array<string>) + type=="string" → array<string>', async () => expect(await typedR('["a", "b"]', F('(x) => type(x) == "string"'))).toBe('array<string>'));
test('12 [1,"a"] + type=="string" → array<string>', async () => expect(await typedR('[1, "a"]', F('(x) => type(x) == "string"'))).toBe('array<string>'));
test('13 [1,"a"] + type=="int" → array<integer>', async () => expect(await typedR('[1, "a"]', F('(x) => type(x) == "int"'))).toBe('array<integer>'));
test('14 ["a",null] + x != null → array<string>', async () => expect(await typedR('["a", null]', F('(x) => x != null'))).toBe('array<string>'));
test('15 ["a",null] + truthy x → array<string>', async () => expect(await typedR('["a", null]', F('(x) => x'))).toBe('array<string>'));
test('16 [1,"a",{}] + type!="string" → array<integer | object>', async () => expect(await typedR('[1, "a", {}]', F('(x) => type(x) != "string"'))).toBe('array<integer | object>'));
test('17 [1,"a",{}] + type=="object" → array<object>', async () => expect(await typedR('[1, "a", {}]', F('(x) => type(x) == "object"'))).toBe('array<object>'));
test('18 [1,"a",{}] + type=="int" → array<integer>', async () => expect(await typedR('[1, "a", {}]', F('(x) => type(x) == "int"'))).toBe('array<integer>'));

// ── C. Callback shapes ───────────────────────────────────────────────────────
test('19 block-bodied arrow narrows', async () => expect(await restR(F('(x) => { return type(x) == "string"; }'))).toBe('array<string>'));
test('20 function expression narrows', async () => expect(await restR(F('function(x) { return type(x) == "string"; }'))).toBe('array<string>'));
test('21 differently-named param narrows', async () => expect(await restR(F('(item) => type(item) == "string"'))).toBe('array<string>'));
test('22 two-param callback narrows on first param', async () => expect(await restR(F('(val, idx) => type(val) == "string"'))).toBe('array<string>'));
test('23 zero-param callback → no narrowing', async () => expect(await restR(F('() => true'))).toBe('array'));
test('24 multi-statement block → no narrowing', async () => expect(await restR(F('(x) => { let t = type(x); return t == "string"; }'))).toBe('array'));
test('25 block with two statements → no narrowing', async () => expect(await restR(F('(x) => { print(x); return type(x) == "string"; }'))).toBe('array'));
test('26 guard on a different variable → no narrowing of x', async () => expect(await restR(F('(x) => type(arr) == "string"'))).toBe('array'));

// ── D. Predicates that are NOT type guards → element unchanged ───────────────
test('27 length(x) > 0 → no narrowing', async () => expect(await restR(F('(x) => length(x) > 0'))).toBe('array'));
test('28 numeric x > 5 → array<integer | double> (reused numeric-comparison guard)', async () => expect(await restR(F('(x) => x > 5'))).toBe('array<integer | double>'));
test('29 member truthy x.enabled → no narrowing of x', async () => expect(await restR(F('(x) => x.enabled'))).toBe('array'));
test('30 opaque call helper(x) → no narrowing', async () => expect(await restR(F('(x) => index(x, "a") != -1'))).toBe('array'));
test('31 constant true → no narrowing', async () => expect(await restR(F('(x) => true'))).toBe('array'));
test('32 length truthy bare length(x) → no narrowing', async () => expect(await restR(F('(x) => length(x)'))).toBe('array'));

// ── E. Only filter narrows; input edge cases ────────────────────────────────
test('33 map() is NOT narrowed', async () => expect(await restR('map(arr, (x) => type(x) == "string")')).toBe('array'));
test('34 sort() is NOT predicate-narrowed', async () => {
  const t = await restR('sort(arr, (a, b) => a < b)');
  expect(t.startsWith('array')).toBe(true);
  expect(t).not.toBe('array<string>');
});
test('35 unknown (non-array) input → not narrowed (array | null)', async () => {
  const code = `function f(thing) {\n    let r = filter(thing, (x) => type(x) == "string");\n}\n`;
  expect(await clean(await server.getHover(code, uri(), 1, 8))).toBe('array | null');
});
test('36 bare array literal input narrows', async () => expect(await typedR('[]', F('(x) => type(x) == "string"'))).toBe('array<string>'));

// ── F. Downstream typing flows from the narrowed element ────────────────────
test('37 narrowed element flows to index access (string)', async () => {
  const code = `function f(...arr) {\n    let r = filter(arr, (x) => type(x) == "string");\n    let e = r[0];\n}\n`;
  expect(await clean(await server.getHover(code, uri(), 2, 8))).toContain('string');
});
test('38 narrowed element makes a downstream substr clean (strict)', async () => {
  const code = `'use strict';\nfunction f(...arr) {\n    let r = filter(arr, (x) => type(x) == "string");\n    for (let e in r) { let z = substr(e, 0); }\n}\n`;
  expect((await errs(code)).some((m) => /substr\(\).*unknown/.test(m))).toBe(false);
});
test('39 WITHOUT narrowing (length pred), downstream substr is flagged (strict)', async () => {
  const code = `'use strict';\nfunction f(...arr) {\n    let r = filter(arr, (x) => length(x) > 0);\n    for (let e in r) { let z = substr(e, 0); }\n}\n`;
  expect((await errs(code)).some((m) => /substr\(\).*unknown/.test(m))).toBe(true);
});
test('40 reassignment narrows the variable (merge_arrays pattern)', async () => {
  const code = `function f(...values) {\n    values = filter(values, (x) => type(x) == "string");\n    let r = values;\n}\n`;
  expect(await clean(await server.getHover(code, uri(), 2, 8))).toBe('array<string>');
});
test('41 length() of a narrowed filter result is fine (still an array)', async () => {
  const code = `'use strict';\nfunction f(...arr) {\n    let r = filter(arr, (x) => type(x) == "string");\n    let n = length(r);\n}\n`;
  expect((await errs(code)).some((m) => /length\(\).*unknown/.test(m))).toBe(false);
});
test('42 nested filter does not crash and the inner result narrows', async () => {
  const code = `function f(...arr) {\n    let r = filter(filter(arr, (x) => type(x) == "string"), (y) => length(y) > 0);\n}\n`;
  // outer pred is length (no narrow) but inner is type=="string"; result stays an array, no crash
  const t = await clean(await server.getHover(code, uri(), 1, 8));
  expect(t.startsWith('array')).toBe(true);
});

// ── G. Soundness: no spurious diagnostics, correct structure ────────────────
test('43 a valid type-guard filter call emits no errors', async () => {
  const code = `function f(...arr) {\n    let r = filter(arr, (x) => type(x) == "string");\n}\n`;
  expect((await errs(code)).length).toBe(0);
});
test('44 the predicate body itself is not flagged (type() handles unknown)', async () => {
  const code = `'use strict';\nfunction f(...arr) {\n    let r = filter(arr, (x) => type(x) == "string");\n}\n`;
  expect((await errs(code)).length).toBe(0);
});
test('45 filter(arr, 5) — non-function predicate still flags arg 2, no narrowing crash', async () => {
  const code = `function f(...arr) {\n    let r = filter(arr, 5);\n}\n`;
  const e = await errs(code);
  expect(e.some((m) => /filter/i.test(m) && /function/i.test(m))).toBe(true);
});
test('46 AND of type + length narrows on the type part', async () => expect(await restR(F('(x) => type(x) == "string" && length(x) > 0'))).toBe('array<string>'));
test('47 negation removes a type from a typed union', async () => expect(await typedR('[1, "a"]', F('(x) => type(x) != "int"'))).toBe('array<string>'));
test('48 type=="function" → array<function>', async () => expect(await restR(F('(x) => type(x) == "function"'))).toBe('array<function>'));
test('49 narrowed result keeps array element access typed (string | null)', async () => {
  const code = `function f(...arr) {\n    let r = filter(arr, (x) => type(x) == "string");\n    let e = r[0];\n}\n`;
  expect(await clean(await server.getHover(code, uri(), 2, 8))).toBe('string | null');
});
test('50 end-to-end: filtered-then-returned element is usable, no diagnostics', async () => {
  const code = `'use strict';\nexport function only_strings(...values) {\n    values = filter(values, (x) => type(x) == "string");\n    return length(values) ? values[0] : "";\n}\n`;
  expect((await errs(code)).length).toBe(0);
});
