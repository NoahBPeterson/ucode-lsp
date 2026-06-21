// Member-property types are flow-sensitive: `obj.p` reads the type of the most-recent
// assignment AT OR BEFORE the read position, not one final type for every occurrence.
// Motivated by fw4.uc parse_weekdays, where `rv.days` is built as a map (`(rv.days ||=
// {})[k]=true`) and then reassigned (`rv.days = keys(rv.days)`): it must read `object`
// while it's a map and `array<string>` only after the keys() reassignment.
//
// Also covers: hover is suppressed inside comments (a word there must not resolve to a
// symbol, which previously surfaced the enclosing `function(val)`).

const { test, expect, describe, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });
const uri = () => `/tmp/fsmt-${n++}.uc`;
function at(code, needle, occ = 1, plus = 0) {
  let i = -1; for (let k = 0; k < occ; k++) i = code.indexOf(needle, i + 1); i += plus;
  const pre = code.slice(0, i);
  return { line: pre.split('\n').length - 1, character: i - pre.lastIndexOf('\n') - 1 };
}
async function hover(code, needle, occ, plus) {
  const p = at(code, needle, occ, plus);
  const h = await server.getHover(code, uri(), p.line, p.character);
  const v = h && h.contents && (h.contents.value || h.contents);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}

const PW = `function to_array(x) { return x; }
let fw = {
	parse_invert: function(val) { return { val: val, invert: false }; },
	parse_weekdays: function(val) {
		let rv = this.parse_invert(val);
		if (!rv) return null;
		for (let day in to_array(rv.val)) {
			(rv.days ||= {})[day] = true;
			rv.days;
		}
		rv.days;
		rv.days = keys(rv.days);
		return rv.days ? rv : null;
	}
};`;

describe('flow-sensitive member types (fw4 parse_weekdays)', () => {
  test('rv.days is object at the `||= {}` bucket write', async () => {
    expect(await hover(PW, 'rv.days ||=', 1, 3)).toMatch(/`object`/);
  });
  test('rv.days is object inside the loop', async () => {
    expect(await hover(PW, 'rv.days;', 1, 3)).toMatch(/`object`/);
  });
  test('rv.days is object after the loop (before keys())', async () => {
    expect(await hover(PW, 'rv.days;', 2, 3)).toMatch(/`object`/);
  });
  test('the keys() argument sees object (so no UC2004 fires)', async () => {
    expect(await hover(PW, 'keys(rv.days)', 1, 8)).toMatch(/`object`/);
  });
  test('rv.days is array<string> after `rv.days = keys(rv.days)`', async () => {
    expect(await hover(PW, 'return rv.days', 1, 10)).toMatch(/`array<string>`/);
  });
  test('keys(rv.days) does NOT raise UC2004 (arg is object there)', async () => {
    const d = (await server.getDiagnostics(PW, uri())) || [];
    expect(d.some((x) => x.code === 'UC2004')).toBe(false);
  });
  test('rv.val hovers as an (unknown) property of the object rv (not "no hover")', async () => {
    expect(await hover(PW, 'rv.val', 1, 3)).toMatch(/val/);
  });

  // A single-assignment member is unchanged (no history → flat type).
  test('a plain single-write member keeps its type', async () => {
    const code = `let o = {};\no.k = "s";\nlet z = o.k;`;
    expect(await hover(code, 'z = o', 1, 0)).toMatch(/`string`/);
  });
});

describe('hover is suppressed inside comments', () => {
  const code = `function val() { return 1; }\nlet rv = { d: 1 };\n// val and rv mentioned here must not hover\nlet x = rv.d;`;
  test('a symbol-matching word inside a // comment gives no hover', async () => {
    const p = at(code, 'val and rv', 1, 0); // cursor on `val` inside the comment
    const h = await server.getHover(code, uri(), p.line, p.character);
    expect(h == null || h.contents == null).toBe(true);
  });
  test('real code still hovers', async () => {
    expect(await hover(code, 'x = rv.d', 1, 4)).toMatch(/`object`/);
  });
});
