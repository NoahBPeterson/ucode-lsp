// A `return <var>` where the variable is narrowed by a type guard (e.g. `if (type(v) == "array")
// return v;`) must contribute the NARROWED type to the inferred return type — not the param's
// widened `unknown`. Regression: `as_list` below inferred `array | unknown` instead of `array`.
// (docs/return-type-guard-narrowing.md)
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let s;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

// Hover the function name (col points at the identifier) and pull the "Returns: `T`" type.
const ret = async (code) => {
  const h = await s.getHover(code, '/tmp/rtgn.uc', 0, 9);
  const v = (h && h.contents && h.contents.value) || '';
  const m = v.match(/Returns: `([^`]+)`/);
  return m ? m[1] : '(none)';
};

test('as_list: every path yields array → Returns `array` (not `array | unknown`)', async () => {
  const t = await ret(
    "function as_list(v) {\n" +
    "\tif (type(v) == \"array\") return v;\n" +
    "\tif (type(v) == \"string\" && length(v) > 0) return [v];\n" +
    "\treturn [];\n" +
    "}\n");
  expect(t).toBe('array');
});

test('a `type(v) == "string"` guard makes `return v` contribute `string`', async () => {
  const t = await ret("function s(v) {\n\tif (type(v) == \"string\") return v;\n\treturn \"\";\n}\n");
  expect(t).toBe('string');
});

test('a disjunctive guard narrows to the union of the guarded types', async () => {
  const t = await ret("function u(v) {\n\tif (type(v) == \"array\" || type(v) == \"object\") return v;\n\treturn null;\n}\n");
  // v narrowed to array|object in the guarded return, plus the `return null` path.
  expect(t.includes('array')).toBe(true);
  expect(t.includes('object')).toBe(true);
  expect(t.includes('null')).toBe(true);
});

test('SOUND: an unguarded `return v` stays `unknown` (no false narrowing)', async () => {
  const t = await ret("function id(v) { return v; }\n");
  expect(t).toBe('unknown');
});

test('SOUND: `return v` in the ELSE of the guard is not narrowed to the guarded type', async () => {
  // In the else branch v is NOT an array; returning it must not claim `array`.
  const t = await ret("function e(v) {\n\tif (type(v) == \"array\") return length(v);\n\treturn v;\n}\n");
  expect(t).not.toBe('array');
});
