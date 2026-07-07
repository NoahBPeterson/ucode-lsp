// Regression tests for the JSDoc @typedef/@param parser cluster (batch B, tickets 64-68,
// 154-161). The @typedef/@property/@param extraction was rewritten from non-nesting
// regexes into a small tokenizer that handles balanced braces (`{{a: string}}`), optional
// `[name]` / dotted `pos.x` names, both @typedef tag orders, and alias base types.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

let n = 0;
const codesOf = (d) => (d || []).map((x) => x.code);
const msgsOf = (d) => (d || []).map((x) => x.message);
async function diags(code) {
  const fp = `/tmp/jtc-${n++}.uc`;
  return (await server.getDiagnostics(code, fp)) || [];
}
const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';

// ── 64: inline object-shape @param `{{a: string}}` ──────────────────────────
test('64 inline object @param shape resolves its members', async () => {
  const good = await diags('/** @param {{a: string}} x */\nfunction f(x){return x.a;}\nprint(f({a:"h"}));\n');
  expect(codesOf(good)).not.toContain('UC7001');
  expect(codesOf(good)).not.toContain('UC7004');
});
test('64 inline object @param flags an unknown member (UC7004)', async () => {
  const bad = await diags('/** @param {{a: string}} x */\nfunction f(x){return x.b;}\nprint(f({a:"h"}));\n');
  expect(codesOf(bad)).toContain('UC7004');
});

// ── 65: `@param string x` (missing braces) → one UC7008, not UC7001+UC7002 ───
test('65 missing braces emits UC7008 only', async () => {
  const d = await diags('/** @param string x */\nfunction f(x) { return x; }\nprint(f("a"));\n');
  expect(codesOf(d)).toContain('UC7008');
  expect(codesOf(d)).not.toContain('UC7001');
  expect(codesOf(d)).not.toContain('UC7002');
});
test('65 legacy bare `@param name type` still works (no false UC7008)', async () => {
  const d = await diags('/** @param x string */\nfunction f(x) { return x; }\nprint(f("a"));\n');
  expect(codesOf(d)).not.toContain('UC7008');
  expect(codesOf(d)).not.toContain('UC7001');
});

// ── 66: `{string|Bogus}` keeps the resolvable arm AND still warns ────────────
test('66 partial union warns UC7001 but keeps the string arm', async () => {
  const d = await diags('/** @param {string|Bogus} x */\nfunction f(x){ return length(x); }\nf(123);\n');
  expect(codesOf(d)).toContain('UC7001');
  // The `string` arm survived: passing an integer is now a detected mismatch.
  expect(msgsOf(d).some((m) => /expected 'string'|possibly 'integer'/.test(m))).toBe(true);
});

// ── 67: two @param tags for the same name → UC7006 ──────────────────────────
test('67 duplicate @param flagged UC7006', async () => {
  const d = await diags('/**\n * @param {string} x\n * @param {integer} x\n */\nfunction f(x){return x;}\nprint(f(1));\n');
  expect(codesOf(d)).toContain('UC7006');
});

// ── 68: a blank line between doc comment and function severs attachment ──────
test('68 blank line detaches the JSDoc (UC7003 fires in strict mode)', async () => {
  const d = await diags("'use strict';\n/** @param {string} p */\n\nfunction f(p) { return p; }\nprint(f(\"x\"));\n");
  expect(codesOf(d)).toContain('UC7003');
});
test('68 no blank line keeps the JSDoc attached (no UC7003)', async () => {
  const d = await diags("'use strict';\n/** @param {string} p */\nfunction f(p) { return p; }\nprint(f(\"x\"));\n");
  expect(codesOf(d)).not.toContain('UC7003');
});

// ── 154: a @property whose type is another @typedef is kept in the shape ─────
test('154 typedef-typed property is not dropped from the shape', async () => {
  const d = await diags(
    '/** @typedef {Object} Point\n *  @property {integer} x */\n' +
    '/** @typedef {Object} Shape\n *  @property {Point} origin\n *  @property {integer} id */\n' +
    '/** @param {Shape} s */\nfunction f(s){return s.origin;}\nprint(f({}));\n');
  expect(codesOf(d)).not.toContain('UC7004');
});

// ── 155: dotted @property `pos.x` builds a nested object member ──────────────
test('155 dotted @property builds a nested object (no false UC5003/UC7004)', async () => {
  const d = await diags(
    '/** @typedef {Object} T\n *  @property {integer} pos.x\n *  @property {integer} pos.y */\n' +
    '/** @param {T} o */\nfunction f(o) { return o.pos.x; }\nprint(f({}));\n');
  expect(codesOf(d)).not.toContain('UC5003');
  expect(codesOf(d)).not.toContain('UC7004');
});

// ── 156: optional `[total]` @property is kept (widened with null) ────────────
test('156 optional @property [total] is present in the shape', async () => {
  const d = await diags(
    '/** @typedef {Object} T\n *  @property {integer} count\n *  @property {integer} [total] */\n' +
    '/** @param {T} t */\nfunction f(t) { return t.total; }\nprint(f({count:1}));\n');
  expect(codesOf(d)).not.toContain('UC7004');
});

// ── 157: inline object @typedef `{{x: integer}}` registers a shape ──────────
test('157 inline object @typedef registers and resolves', async () => {
  const d = await diags(
    '/** @typedef {{x: integer, y: integer}} Point */\n' +
    '/** @param {Point} p */\nfunction f(p){return p.x;}\nprint(f({x:1,y:2}));\n');
  expect(codesOf(d)).not.toContain('UC7001');
  expect(codesOf(d)).not.toContain('UC7004');
});

// ── 158: reversed `@typedef Name {Type}` order is recognized ────────────────
test('158 alternate @typedef order is recognized (no false UC7001)', async () => {
  const d = await diags(
    '/** @typedef Point {Object}\n *  @property {integer} x */\n' +
    '/** @param {Point} p */\nfunction f(p) { return p.x; }\nprint(f({x:1}));\n');
  expect(codesOf(d)).not.toContain('UC7001');
});

// ── 159: alias typedef carries its base type / properties ───────────────────
test('159 union alias typedef resolves to the union (hover)', async () => {
  const code = '/** @typedef {string|integer} ID */\n/** @param {ID} id */\nfunction f(id){return id;}\nprint(f(1));\n';
  const fp = '/tmp/jtc-alias-union.uc';
  await server.getDiagnostics(code, fp);
  const h = firstLine(await server.getHover(code, fp, 2, code.split('\n')[2].indexOf('(id') + 1));
  expect(h).toMatch(/string/);
  expect(h).toMatch(/integer|int/);
});
test('159 object alias typedef inherits properties', async () => {
  const d = await diags(
    '/** @typedef {Object} Point\n *  @property {integer} x */\n' +
    '/** @typedef {Point} Coord */\n' +
    '/** @param {Coord} c */\nfunction f(c){return c.x;}\nprint(f({x:1}));\n');
  expect(codesOf(d)).not.toContain('UC7004');
  expect(codesOf(d)).not.toContain('UC7001');
});

// ── 160: @callback and @template names are known (no false UC7001) ──────────
test('160 @callback and @template suppress false UC7001', async () => {
  const d = await diags(
    '/** @callback Handler */\n/** @param {Handler} cb */\nfunction reg(cb){return cb;}\n' +
    '/** @template U\n * @param {U} x\n * @returns {U} */\nfunction id(x){return x;}\nprint(reg(id));\n');
  expect(codesOf(d)).not.toContain('UC7001');
});

// ── 161: malformed typedefs are no longer silent (UC7007) ───────────────────
test('161 nameless @typedef, orphan @property, duplicate @property all flag UC7007', async () => {
  const d = await diags(
    '/** @typedef {Object} */\n' +
    '/** @property {integer} orphan */\n' +
    '/** @typedef {Object} Foo\n *  @property {integer} x\n *  @property {string} x */\n' +
    '/** @param {Foo} p */\nfunction f(p){return p.x;}\nprint(f({}));\n');
  const uc7007 = (d || []).filter((x) => x.code === 'UC7007');
  expect(uc7007.length).toBe(3);
  expect(msgsOf(d).some((m) => /missing a name/.test(m))).toBe(true);
  expect(msgsOf(d).some((m) => /no enclosing @typedef/.test(m))).toBe(true);
  expect(msgsOf(d).some((m) => /Duplicate @property/.test(m))).toBe(true);
});

// ── 160b: @enum const names and function(...) type expressions are known ────
test('160b @enum name and function() type suppress false UC7001', async () => {
  const d = await diags(
    '/** @enum {integer} */\nconst Colors = { RED: 0, GREEN: 1 };\n' +
    '/** @param {Colors} c */\nfunction h(c){return c;}\n' +
    '/** @param {function(integer): string} k */\nfunction m(k){return k(2);}\n' +
    'print(h(Colors.RED), m(null));\n');
  expect(codesOf(d)).not.toContain('UC7001');
  // {function(...)} params resolve to a callable: null arg flags as function-expected
  expect(msgsOf(d).some((m) => /Function 'm'.*expected 'function'/.test(m))).toBe(true);
});
