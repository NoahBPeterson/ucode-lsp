const assert = require('assert');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Dictionary/map value-shape inference: a local object used as a string-keyed
// map (`let m = {}; m[k] = {…}`) gets a value shape, so `let v = m[k]` and
// `v.prop` resolve instead of `unknown`. Covers Stage 1 (direct computed
// assignment) and Stage 2 (one setter hop), intersection soundness, and the
// mixed-value bail.
describe('Dictionary value-shape inference', function () {
  this.timeout(15000);

  let lspServer, getHover, getDiagnostics;
  const FP = '/tmp/dict-value-shape.uc';
  const txt = (h) => (h && h.contents ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '') : '');

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });
  after(function () { if (lspServer) lspServer.shutdown(); });

  // Find the first line containing `lineSubstr`, then hover the `ident` within it.
  async function hoverIdent(code, lineSubstr, ident) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const base = lines[i].indexOf(lineSubstr);
      if (base < 0) continue;
      const c = lines[i].indexOf(ident, base);
      if (c >= 0) return txt(await getHover(code, FP, i, c));
    }
    return '(not found)';
  }

  it('Stage 1: direct `m[k] = {…}` → v.prop resolves', async () => {
    const code = [
      "'use strict';",
      'function f() {',
      '\tlet m = {};',
      "\tm['x'] = { a: 'hello', b: 1 };",
      "\tm['y'] = { a: 'world', b: 2 };",
      '\tfor (let k in keys(m)) {',
      '\t\tlet v = m[k];',
      '\t\tlet s = v.a;',
      '\t\tlet n = v.b;',
      '\t}',
      '}',
      '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = m[k]', 'v'), /object/, 'v should be object');
    assert.match(await hoverIdent(code, 'v.a', 'a'), /string/, 'v.a should be string');
    assert.match(await hoverIdent(code, 'v.b', 'b'), /integer/, 'v.b should be integer');
  });

  it('Stage 2: one setter hop `set(k, data){ m[k]=data }` → v.prop resolves', async () => {
    const code = [
      "'use strict';",
      'function make() {',
      '\tlet reg = {};',
      '\tfunction set_i(k, data) { reg[k] = data; }',
      "\tset_i('a', { mark: '1', dev: 'eth0', up: true });",
      "\tset_i('b', { mark: '2', dev: 'eth1', up: false, extra: 'only-here' });",
      '\tfunction build() {',
      '\t\tfor (let n in keys(reg)) {',
      '\t\t\tlet it = reg[n];',
      '\t\t\tlet d = it.dev;',
      '\t\t\tlet u = it.up;',
      '\t\t\tlet e = it.extra;',
      '\t\t}',
      '\t}',
      '\treturn { build };',
      '}',
      '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let it = reg', 'it'), /object/, 'it should be object');
    assert.match(await hoverIdent(code, 'it.dev', 'dev'), /string/, 'it.dev should be string (setter hop)');
    assert.match(await hoverIdent(code, 'it.up', 'up'), /boolean/, 'it.up should be boolean');
    // `extra` is present in only ONE of the two set_i calls → dropped by intersection.
    assert.match(await hoverIdent(code, 'it.extra', 'extra'), /unknown/, 'it.extra should stay unknown (intersection)');
  });

  it('Negative: mixed-value map (string AND object writes) → no shape, unknown', async () => {
    const code = [
      "'use strict';",
      'function g() {',
      '\tlet mm = {};',
      "\tmm['x'] = 'a string';",
      "\tmm['y'] = { a: 1 };",
      '\tfor (let k in keys(mm)) {',
      '\t\tlet v = mm[k];',
      '\t\tlet a = v.a;',
      '\t}',
      '}',
      '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = mm[k]', 'v'), /unknown/, 'v should be unknown (mixed map bailed)');
  });

  it('does not emit a missing-member (UC7004) diagnostic on a dict value (shape is intersection-incomplete)', async () => {
    const code = [
      "'use strict';",
      'function f() {',
      '\tlet m = {};',
      "\tm['x'] = { a: 'hello' };",
      '\tfor (let k in keys(m)) {',
      '\t\tlet v = m[k];',
      '\t\tlet z = v.not_a_member;',
      '\t}',
      '}',
      '',
    ].join('\n');
    const ds = (await getDiagnostics(code, FP)).filter(d => d.code === 'UC7004');
    assert.strictEqual(ds.length, 0, `dict values are not closed shapes; got UC7004: ${JSON.stringify(ds.map(d => d.message))}`);
  });

  // ── Scoping & shadowing ────────────────────────────────────────────────

  it('shadowing: a nested `let m` with a different shape does NOT pollute the outer map', async () => {
    const code = [
      "'use strict';",
      'function outer() {',
      '\tlet m = {};',
      "\tm['a'] = { x: 1, common: 'o' };",
      '\tfunction inner() {',
      '\t\tlet m = {};',                      // shadows
      "\t\tm['b'] = { x: 'str', common: 'i' };", // different x type
      '\t}',
      '\tfor (let k in keys(m)) {',
      '\t\tlet v = m[k];',
      '\t\tlet xv = v.x;',
      '\t}',
      '}',
      '',
    ].join('\n');
    const xv = await hoverIdent(code, 'v.x', 'x');
    assert.match(xv, /integer/, 'outer v.x should be integer (from outer write only)');
    assert.doesNotMatch(xv, /string/, 'outer v.x must NOT be polluted by inner map (string)');
  });

  it('order independence: reader function defined BEFORE the writer still resolves', async () => {
    const code = [
      "'use strict';",
      'function f() {',
      '\tlet m = {};',
      '\tfunction read() {',
      '\t\tfor (let k in keys(m)) { let v = m[k]; let a = v.a; }',
      '\t}',
      "\tm['x'] = { a: 'hi' };",
      '\treturn read;',
      '}',
      '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.a', 'a'), /string/, 'v.a should resolve even though writer is after reader');
  });

  // ── Value-shape edge cases ─────────────────────────────────────────────

  it('differing types for the same key → union (no silent mistype)', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = { s: 1 };", "\tm['b'] = { s: 'x' };",
      '\tfor (let k in keys(m)) { let v = m[k]; let sv = v.s; }', '}', '',
    ].join('\n');
    const sv = await hoverIdent(code, 'v.s', 's');
    assert.match(sv, /integer/, 'union should include integer');
    assert.match(sv, /string/, 'union should include string');
  });

  it('no common keys across writes → intersection empty → unknown', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = { x: 1 };", "\tm['b'] = { y: 2 };",
      '\tfor (let k in keys(m)) { let v = m[k]; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = m[k]', 'v'), /unknown/, 'no common keys → v unknown');
  });

  it('all-empty-object values → no value shape → unknown', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = {};", "\tm['b'] = {};",
      '\tfor (let k in keys(m)) { let v = m[k]; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = m[k]', 'v'), /unknown/, 'empty values → v unknown');
  });

  it('nested-object, array, and function value members', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = { inner: { z: 1 }, arr: [1,2], fn: function() { return 1; } };",
      '\tfor (let k in keys(m)) { let v = m[k]; let i = v.inner; let r = v.arr; let g = v.fn; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.inner', 'inner'), /object/, 'nested object → object');
    assert.match(await hoverIdent(code, 'v.arr', 'arr'), /array/, 'array value → array');
    assert.match(await hoverIdent(code, 'v.fn', 'fn'), /function/, 'function value → function');
  });

  it('spread in a value literal is handled gracefully (other keys still typed)', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet base = { p: 1 };', '\tlet m = {};',
      "\tm['a'] = { ...base, q: 'hi' };",
      '\tfor (let k in keys(m)) { let v = m[k]; let qq = v.q; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.q', 'q'), /string/, 'spread ignored, q still string (no crash)');
  });

  it('const map works like let', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tconst m = {};',
      "\tm['a'] = { n: 7 };",
      '\tfor (let k in keys(m)) { let v = m[k]; let nn = v.n; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.n', 'n'), /integer/, 'const map value resolves');
  });

  // ── Read-side variants ─────────────────────────────────────────────────

  it('literal-key access `m["x"]` gets the value shape', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = { a: 'hi' };",
      "\tlet v = m['x'];", '\tlet aa = v.a;', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.a', 'a'), /string/, 'literal-key read resolves value shape');
  });

  it('arbitrary-variable key (not from keys()) still resolves', async () => {
    const code = [
      "'use strict';", 'function f(kk) {', '\tlet m = {};',
      "\tm['a'] = { a: 1 };",
      '\tlet v = m[kk];', '\tlet aa = v.a;', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.a', 'a'), /integer/, 'arbitrary key read resolves value shape');
  });

  it('direct `for (k in m)` iteration (no keys()) resolves', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = { a: 'hi' };",
      '\tfor (let k in m) { let v = m[k]; let aa = v.a; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.a', 'a'), /string/, 'for-in over the map resolves');
  });

  it('direct chain `m[k].prop` (no intermediate binding) is graceful → unknown, no crash', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = { a: 'hi' };",
      '\tfor (let k in keys(m)) { let z = m[k].a; }', '}', '',
    ].join('\n');
    // documents the known limitation: the shape only rides on a `let v = m[k]` binding.
    assert.match(await hoverIdent(code, 'let z = m[k]', 'z'), /unknown/, 'direct chain → unknown (no binding to carry shape)');
  });

  // ── Setter-hop edge cases ──────────────────────────────────────────────

  it('setter param at index 0 (`set(data, key)`)', async () => {
    const code = [
      "'use strict';", 'function make() {', '\tlet r = {};',
      '\tfunction set_i(data, k) { r[k] = data; }',
      "\tset_i({ a: 1 }, 'x');",
      '\tfunction rd() { for (let n in keys(r)) { let v = r[n]; let aa = v.a; } }',
      '\treturn rd;', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.a', 'a'), /integer/, 'param-0 setter resolves');
  });

  it('multiple setters feeding one map → intersection across all call sites', async () => {
    const code = [
      "'use strict';", 'function make() {', '\tlet r = {};',
      '\tfunction set1(k, d) { r[k] = d; }',
      '\tfunction set2(k, d) { r[k] = d; }',
      "\tset1('a', { x: 1, y: 2 });",
      "\tset2('b', { x: 3 });",                 // y missing here
      '\tfunction rd() { for (let n in keys(r)) { let v = r[n]; let xx = v.x; let yy = v.y; } }',
      '\treturn rd;', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'v.x', 'x'), /integer/, 'x present in all → integer');
    assert.match(await hoverIdent(code, 'v.y', 'y'), /unknown/, 'y missing in set2 → dropped');
  });

  it('setter called with a non-literal argument → no shape (cannot characterize values)', async () => {
    const code = [
      "'use strict';", 'function make(src) {', '\tlet r = {};',
      '\tfunction set_i(k, d) { r[k] = d; }',
      "\tset_i('a', src);",                     // non-literal arg
      '\tfunction rd() { for (let n in keys(r)) { let v = r[n]; } }',
      '\treturn rd;', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = r[n]', 'v'), /unknown/, 'non-literal setter arg → unknown');
  });

  // ── Negatives / no false positives ─────────────────────────────────────

  it('non-object computed write (`o[k] = 5`) → no shape', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet o = {};',
      "\to['a'] = 5;",
      '\tfor (let k in keys(o)) { let v = o[k]; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = o[k]', 'v'), /unknown/, 'literal-value write → no object shape');
  });

  it('write of a non-param identifier of unknown shape → bail', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet o = {};', '\tlet x = somefn();',
      "\to['a'] = x;",
      '\tfor (let k in keys(o)) { let v = o[k]; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = o[k]', 'v'), /unknown/, 'unknown-ident write → bail');
  });

  it('map never written → unknown (no false positive)', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet o = {};',
      '\tfor (let k in keys(o)) { let v = o[k]; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = o[k]', 'v'), /unknown/, 'unwritten map → unknown');
  });

  it('self-assignment `m[k] = m` bails without hanging', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = {};',
      "\tm['a'] = m;",
      '\tfor (let k in keys(m)) { let v = m[k]; }', '}', '',
    ].join('\n');
    assert.match(await hoverIdent(code, 'let v = m[k]', 'v'), /unknown/, 'self-assign → bail, no infinite loop');
  });

  it('non-empty object literal init is treated as a struct, not value-shaped', async () => {
    const code = [
      "'use strict';", 'function f() {', '\tlet m = { known: 1 };',
      "\tm['a'] = { x: 'str' };",
      '\tfor (let k in keys(m)) { let v = m[k]; let xx = v.x; }', '}', '',
    ].join('\n');
    // empty-only gate: a `{known:1}` init is a struct; the map value shape is NOT inferred.
    assert.doesNotMatch(await hoverIdent(code, 'v.x', 'x'), /string/, 'non-empty init → no value-shape for v.x');
  });
});
