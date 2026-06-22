// #29 follow-up — object-literal spread (`{ ...src, y }`) must carry src's known property
// types into the result, so `merged.x` (from `...oa`) is typed, not unknown.
//
// Hover on a local object's property is a separate unimplemented path (#173), so we assert
// the type via a downstream observable: accessing a member on a property of known scalar
// type flags "does not exist on <type>"; an unknown property stays silent. A spread'd prop
// must behave IDENTICALLY to a directly-written one.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const msgs = async (code) => ((await s.getDiagnostics(code, `/tmp/osp-${n++}.uc`)) || []).map((d) => d.message);

test('spread copies a known property type (integer) from the source object', async () => {
  const m = await msgs('let oa = { x: 1 };\nlet merged = { ...oa };\nmerged.x.foo();\n');
  expect(m.some((x) => /does not exist on integer/.test(x))).toBe(true);
});
test('matches the non-spread baseline exactly', async () => {
  const m = await msgs('let direct = { x: 1 };\ndirect.x.foo();\n');
  expect(m.some((x) => /does not exist on integer/.test(x))).toBe(true);
});
test('a later explicit key overrides the spread (x becomes string)', async () => {
  const m = await msgs('let oa = { x: 1 };\nlet merged = { ...oa, x: "s" };\nmerged.x.foo();\n');
  expect(m.some((x) => /does not exist on string/.test(x))).toBe(true);
  expect(m.some((x) => /does not exist on integer/.test(x))).toBe(false);
});
test('inline object literal as the spread source works', async () => {
  const m = await msgs('let merged = { ...{ a: 1 }, b: 2 };\nmerged.a.foo();\n');
  expect(m.some((x) => /does not exist on integer/.test(x))).toBe(true);
});
test('a property genuinely absent from the spread source stays unflagged', async () => {
  // `nope` is not in oa, so it is unknown — accessing a member on it must NOT flag.
  const m = await msgs('let oa = { x: 1 };\nlet merged = { ...oa };\nmerged.nope.foo();\n');
  expect(m.some((x) => /does not exist on integer/.test(x))).toBe(false);
});
