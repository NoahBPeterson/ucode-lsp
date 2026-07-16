// Fixes from the --type-coverage audit (2026-07-07):
//
//  1. docs/tc-fn-reference-property-returns.md — a method that is a function
//     REFERENCE (not an inline `function(){}` literal) carries no return type,
//     so `obj.method()` / `this.method()` resolved `unknown` even though the
//     referenced function's own return type is fully inferred. Three shapes:
//       (a) identifier-valued object-literal property (`{ select: helper }`)
//       (b) post-hoc property assignment (`nft_file.append = function(){}` /
//           `nft_file.append = helper`, and the `this.append = …` form)
//       (c) export-default object built from post-hoc references
//           (`mwan4.get_iface_id = get_iface_id; export default mwan4;`)
//
//  2. docs/tc-this-method-forward-ref-return.md — `this.method()` called
//     BEFORE the sibling method's definition in the same object literal used
//     to keep the shallow pre-pass return type (`precomputeObjectMethodReturnTypes`
//     visits the sibling's `return` expressions without its own scope, so a
//     return that reads a local resolves `unknown`) even after the sibling was
//     fully visited and its accurate type became known. Fixed via a
//     record-and-patch back-fill: the analyzer records every forward call site
//     resolved from the shallow map, then patches the consumer symbol (and the
//     type checker's cached node type) once the whole object literal has been
//     visited.

const { test, expect, describe, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

let n = 0;
const uri = () => `/tmp/tc-omr-${n++}.uc`;
function at(code, needle, occ = 1, plus = 0) {
  let i = -1; for (let k = 0; k < occ; k++) i = code.indexOf(needle, i + 1); i += plus;
  const pre = code.slice(0, i);
  return { line: pre.split('\n').length - 1, character: i - pre.lastIndexOf('\n') - 1 };
}
async function hoverType(code, needle, filePath, occ = 1, plus = 0) {
  const p = at(code, needle, occ, plus);
  const h = await server.getHover(code, filePath || uri(), p.line, p.character);
  const v = h && h.contents && (h.contents.value || h.contents);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}

describe('shape 1a: identifier-valued object-literal property ("proto table" idiom)', () => {
  test('obj.method() resolves through an Identifier property value', async () => {
    const code = `function helper(x) { return { value: x, ok: true }; }
let obj = { method: helper };
let r = obj.method(5);`;
    expect(await hoverType(code, 'r = obj')).toMatch(/`object`/);
  });

  test('this.method() resolves through an Identifier property value', async () => {
    const code = `function greet(name) { return "hi " + name; }
let api = {
	say: greet,
	use: function() { let r = this.say("x"); return r; }
};`;
    expect(await hoverType(code, 'r = this')).toMatch(/`string`/);
  });

  test('a function-VALUED variable referenced by an Identifier property also resolves', async () => {
    const code = `let helper = function(x) { return true; };
let obj = { method: helper };
let r = obj.method(1);`;
    expect(await hoverType(code, 'r = obj')).toMatch(/`boolean`/);
  });
});

describe('shape 1b: post-hoc property assignment', () => {
  test('local object: obj.prop = function(){…} resolves obj.prop()', async () => {
    const code = `let nft_file = {};
nft_file.append = function(target, extra) {
	return true;
};
let ok = nft_file.append("x", "y");`;
    expect(await hoverType(code, 'ok = nft_file')).toMatch(/`boolean`/);
  });

  test('local object: obj.prop = someHelper (Identifier RHS) resolves obj.prop()', async () => {
    const code = `function helper(x) { return "s"; }
let nft_file = {};
nft_file.append = helper;
let ok = nft_file.append("x");`;
    expect(await hoverType(code, 'ok = nft_file')).toMatch(/`string`/);
  });

  test('this.prop = function(){…} resolves a later this.prop() read in the same method', async () => {
    const code = `let widget = {
	init: function() {
		this.append = function(x) { return true; };
		let ok = this.append(1);
		return ok;
	}
};`;
    expect(await hoverType(code, 'ok = this')).toMatch(/`boolean`/);
  });
});

describe('shape 1c: export-default object built from post-hoc references (cross-file)', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-tc-omr-'));
    // Mirrors mwan4.uc: a base literal, then dozens of `mod.fn = fn;` post-hoc
    // attachments, then `export default mod;` — NOT an inline `export default {...}`.
    fs.writeFileSync(path.join(dir, 'lib.uc'), `function get_val(x) {
	return true;
}
let lib = { name: 'lib' };
lib.get_val = get_val;
export default lib;
`);
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

  test('importer m.get_val(...) resolves the post-hoc-attached function\'s return type', async () => {
    const mainPath = path.join(dir, 'main.uc');
    const code = `import m from './lib.uc';
let r = m.get_val(5);`;
    fs.writeFileSync(mainPath, code);
    expect(await hoverType(code, 'r = m', mainPath)).toMatch(/`boolean`/);
  });
});

describe('ticket 2: forward this.method() call back-fill (docs/tc-this-method-forward-ref-return.md)', () => {
  test('forward call whose sibling return references a LOCAL is patched to the accurate type', async () => {
    // `late`'s return `length(rv.val) ? rv : null` needs `rv` in scope to resolve —
    // the scope-less pre-pass can't see it, so `early`'s `this.late(v)` used to be
    // stuck at the shallow `unknown | null` even after `late` was fully visited.
    const code = `let o = {
	early: function(v) { let rvEarly = this.late(v); return rvEarly; },
	late: function(v) {
		if (v == null) return null;
		let rv = { invert: false };
		return length(rv.val) ? rv : null;
	},
	after: function(v) { let rvAfter = this.late(v); return rvAfter; }
};`;
    const forwardType = await hoverType(code, 'rvEarly = this');
    const backwardType = await hoverType(code, 'rvAfter = this');
    // Parity: the forward (before-def) call site must show the SAME accurate type
    // as the backward (after-def) call site — no more `unknown | null`.
    expect(forwardType).not.toMatch(/unknown/);
    expect(forwardType).toMatch(/object/);
    expect(backwardType).toMatch(/object/);
  });

  test('no regression: forward call whose sibling return is scope-less already stayed correct', async () => {
    const code = `let api = {
	use: function() { let r = this.later(); return r; },
	later: function() { return { x: 1 }; }
};`;
    expect(await hoverType(code, 'r = this')).toMatch(/`object`/);
  });
});
