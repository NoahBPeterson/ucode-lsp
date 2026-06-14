// Completion cluster — #19 nested object members, #20 optional chaining, #23 nl80211/rtnl
// `const.` namespace, #96 named-import module path. All verified valid ucode.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const labels = (items) => (items?.items ?? items ?? []).map((i) => i.label);
const at = async (code, line, ch) => labels(await s.getCompletions(code, `/tmp/cc-${n++}.uc`, line, ch));

// ── #19 nested object-member completion (any depth + aliases) ──
test('o.inner. offers the nested object members, not the parent key', async () => {
  const c = await at('let o = { inner: { x: 1, y: 2 } };\no.inner.\n', 1, 8);
  expect(c).toContain('x'); expect(c).toContain('y');
  expect(c).not.toContain('inner');
});
test('two hops: o.a.b. offers the leaf members', async () => {
  expect(await at('let o = { a: { b: { z: 1 } } };\no.a.b.\n', 1, 6)).toEqual(['z']);
});
test('alias: let i = o.inner; i. offers the nested members', async () => {
  const c = await at('let o = { inner: { x: 1, y: 2 } };\nlet i = o.inner;\ni.\n', 2, 2);
  expect(c).toContain('x'); expect(c).toContain('y');
});
test('first hop still works (regression)', async () => {
  expect(await at('let o = { inner: { x: 1 } };\no.\n', 1, 2)).toContain('inner');
});

// ── #20 optional chaining is a member-access trigger ──
test('o?. offers the same members as o.', async () => {
  const dot = await at('let o = { a: 1, b: 2 };\no.\n', 1, 2);
  const qdot = await at('let o = { a: 1, b: 2 };\no?.\n', 1, 3);
  expect(qdot.filter((l) => ['a', 'b'].includes(l)).sort()).toEqual(['a', 'b']);
  expect(qdot).not.toContain('print'); // not the global builtin fallback
  expect(qdot.sort()).toEqual(dot.sort());
});

// ── #23 nl80211 / rtnl constants under the `const` namespace ──
test('nl80211 nl.const. lists the constants', async () => {
  const c = await at("import * as nl from 'nl80211';\nnl.const.\n", 1, 9);
  expect(c.length).toBeGreaterThan(50);
  expect(c).toContain('NL80211_CMD_GET_WIPHY');
});
test('rtnl rt.const. lists the constants', async () => {
  const c = await at("import * as rt from 'rtnl';\nrt.const.\n", 1, 9);
  expect(c.length).toBeGreaterThan(50);
  expect(c).toContain('RTM_NEWLINK');
});

// ── #96 module-path completion for the named-import form ──
test("import { open } from 'f|' offers modules, not builtins", async () => {
  const c = await at("import { open } from 'fs';\n", 0, 22); // cursor inside the path string
  expect(c).toContain('fs'); expect(c).toContain('math');
  expect(c).not.toContain('print');
});
test("import a, { b } from 'f|' (mixed) also offers modules", async () => {
  const c = await at("import a, { b } from 'fs';\n", 0, 23);
  expect(c).toContain('fs');
});
