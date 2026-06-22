// Object-literal method calls resolve their inferred return type, so `obj.method()`
// and `this.method()` are no longer `unknown`. Motivated by fw4.uc's parse_weekdays,
// where `let rv = this.parse_invert(val)` was typed `unknown`.
//
// Mechanism: a function-valued property's inferred return type is recorded on the
// receiver symbol's `propertyReturnTypes` (and on `this` at method entry), read by
// inferMethodReturnType. Resolution is define-before-use: a sibling method only
// resolves if defined earlier in the object than the call site.

const { test, expect, describe, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

let n = 0;
const uri = () => `/tmp/omrt-${n++}.uc`;
function at(code, needle, occ = 1, plus = 0) {
  let i = -1; for (let k = 0; k < occ; k++) i = code.indexOf(needle, i + 1); i += plus;
  const pre = code.slice(0, i);
  return { line: pre.split('\n').length - 1, character: i - pre.lastIndexOf('\n') - 1 };
}
async function hoverType(code, needle, occ = 1, plus = 0) {
  const p = at(code, needle, occ, plus);
  const h = await server.getHover(code, uri(), p.line, p.character);
  const v = h && h.contents && (h.contents.value || h.contents);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}

describe('object-literal method call return types', () => {
  test('this.method() resolving an object return → object (was unknown)', async () => {
    const code = `let obj = {
	parse_invert: function(val) { return { val: val, invert: false }; },
	parse_weekdays: function(val) { let rv = this.parse_invert(val); return rv; }
};`;
    expect(await hoverType(code, 'rv = this', 1, 0)).toMatch(/`object`/);
  });

  test('external obj.method() resolves after the declaration', async () => {
    const code = `let lib = {
	make: function(nn) { return { id: nn, ok: true }; }
};
let external = lib.make(5);`;
    expect(await hoverType(code, 'external = lib', 1, 0)).toMatch(/`object`/);
  });

  test('a method returning a string literal → string', async () => {
    const code = `let api = {
	name: function() { return "fw4"; },
	use: function() { let nm = this.name(); return nm; }
};`;
    expect(await hoverType(code, 'nm = this', 1, 0)).toMatch(/`string`/);
  });

  test('a method returning a bare parameter stays unknown (no over-claiming)', async () => {
    const code = `let api = {
	passthru: function(x) { return x; },
	use: function() { let r = this.passthru(1); return r; }
};`;
    expect(await hoverType(code, 'r = this', 1, 0)).toMatch(/`unknown`/);
  });

  test('forward reference (method defined later) IS resolved (ucode supports it)', async () => {
    // `use` calls this.later() before `later` is defined; ucode resolves `this` at call
    // time (after the whole object is built), strict and non-strict, so we do too.
    const code = `let api = {
	use: function() { let r = this.later(); return r; },
	later: function() { return { x: 1 }; }
};`;
    expect(await hoverType(code, 'r = this', 1, 0)).toMatch(/`object`/);
  });

  test('forward reference also resolves under \'use strict\'', async () => {
    const code = `let api = {
	use: function() { 'use strict'; let r = this.tag(); return r; },
	tag: function() { return "x"; }
};`;
    expect(await hoverType(code, 'r = this', 1, 0)).toMatch(/`string`/);
  });

  test('no regression: a non-method object property is unaffected', async () => {
    const code = `let conf = { host: "localhost", port: 80 };\nlet h = conf.host;`;
    expect(await hoverType(code, 'h = conf', 1, 0)).toMatch(/`string`/);
  });
});

describe('go-to-definition on object-literal members', () => {
  async function defLine(code, needle, plus) {
    const p = at(code, needle, 1, plus);
    const d = await server.getDefinition(code, uri(), p.line, p.character);
    return d && d.range ? d.range.start.line : null;
  }

  test('obj.method() jumps to the property (the make: key)', async () => {
    const code = `let factory = {\n\tmake: function(id) { return { id: id }; }\n};\nlet built = factory.make(7);`;
    // cursor mid-word in `make` on the call line (line 3, 0-based)
    expect(await defLine(code, 'factory.make', 9)).toBe(1); // line 2 (0-based 1) = make: key
  });

  test('this.method() jumps to the sibling property', async () => {
    const code = `let widget = {\n\tpinv: function(v) { return { v: v }; },\n\tpwk: function(v) { let rv = this.pinv(v); return rv; }\n};`;
    expect(await defLine(code, 'this.pinv', 7)).toBe(1); // line 2 (0-based 1) = pinv: key
  });
});
