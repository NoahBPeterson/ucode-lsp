// E2e: proto() as a first-class concept (docs/prototypes-as-a-first-class-concept.md).
//
// ucode has no `class` — `proto(instance, proto_table)` IS its OOP (32 sites in
// the tracked OpenWrt trees: wdev_proto, phy_proto, vlist_proto, LuCI's runtime
// Class…). The analyzer stamps the MERGED chain shape onto the binding's symbol,
// so completion, hover, go-to-definition, signature help, member typing, and
// `this` typing all resolve prototype members through the ordinary symbol maps.
//
// Runtime ground truth verified LIVE on owrt-main (2026-08-14):
//   - proto(v, P) returns v; type(v) UNCHANGED (array instances stay arrays,
//     with methods, `this`, and numeric indexing all working at once);
//   - member lookup walks the chain, own members shadow the prototype;
//   - inside a method invoked via the instance, `this` IS the instance
//     (proven: proto([3,1,2], {first}) → a.first() === shift semantics);
//   - a second proto(v, P2) REPLACES the prototype.
import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
let n = 0;
const fp = (t) => `/tmp/proto-fc-${t}-${n++}.uc`;
const text = (h) => (!h || !h.contents) ? '' : (typeof h.contents === 'string' ? h.contents : (h.contents.value || ''));
const labels = (compl) => (Array.isArray(compl) ? compl : (compl && compl.items) || []).map(i => i.label);

// Position of the `occ`-th occurrence of `sub` (cursor ON its first character).
function posOf(code, sub, occ = 1) {
  let i = -1;
  for (let k = 0; k < occ; k++) { i = code.indexOf(sub, i + 1); if (i === -1) throw new Error('not found: ' + sub); }
  const pre = code.slice(0, i);
  return { line: (pre.match(/\n/g) || []).length, character: i - (pre.lastIndexOf('\n') + 1) };
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
});

// The wdev idiom from wifi-scripts, condensed.
const WDEV = `'use strict';

const wdev_proto = {
	get_name: function() {
		return this.name;
	},
	set_config: function(cfg, flag) {
		this.config = cfg;
		return this;
	},
};

/** @param {string} name */
function wdev_new(name) {
	return proto({ name: name, config: null }, wdev_proto);
}

let w = proto({ name: "phy0", config: null }, wdev_proto);
let n1 = w.get_name();
let w2 = wdev_new("phy1");
let n2 = w2.get_name();
print(n1, n2);
`;

describe('completion through the prototype chain', () => {
  test('direct proto() binding: w. offers prototype methods AND own fields', async () => {
    const code = WDEV + 'w.';
    const lines = code.split('\n');
    const compl = await server.getCompletions(code, fp('compl-w'), lines.length - 1, 2);
    const ls = labels(compl);
    expect(ls).toContain('get_name');
    expect(ls).toContain('set_config');
    expect(ls).toContain('name');
    expect(ls).toContain('config');
  });

  test('ARRAY instance offers its prototype methods (arrays have no own named members)', async () => {
    const code = `const arr_proto = {\n\tmylen: function() {\n\t\treturn length(this);\n\t},\n};\nlet a = proto([3, 1, 2], arr_proto);\nprint(a);\na.`;
    const lines = code.split('\n');
    const compl = await server.getCompletions(code, fp('compl-arr'), lines.length - 1, 2);
    expect(labels(compl)).toContain('mylen');
  });

  test('factory-returned instance (`return proto({…}, P)`) offers the chain', async () => {
    const code = WDEV + 'w2.';
    const lines = code.split('\n');
    const compl = await server.getCompletions(code, fp('compl-fact'), lines.length - 1, 3);
    const ls = labels(compl);
    expect(ls).toContain('get_name');
    expect(ls).toContain('name');
  });
});

describe('hover through the prototype chain', () => {
  test('w.get_name hovers as a function property with a definition link', async () => {
    const p = posOf(WDEV, 'get_name();'); // first use: n1 = w.get_name()
    const h = await server.getHover(WDEV, fp('hover-m'), p.line, p.character);
    expect(text(h)).toContain('get_name');
    expect(text(h)).toContain('function');
    expect(text(h)).toContain('Defined in');
  });

  test('method return type flows: this.name types n1 as string', async () => {
    const p = posOf(WDEV, 'n1 = ');
    const h = await server.getHover(WDEV, fp('hover-ret'), p.line, p.character + 1);
    expect(text(h)).toContain('string');
  });

  test('2-level chain: a method from the BASE prototype resolves and types', async () => {
    const code = `'use strict';
const base_proto = {
	describe: function() {
		return "base";
	},
};
const wdev_proto = proto({
	get_name: function() {
		return this.name;
	},
}, base_proto);
let w = proto({ name: "phy0" }, wdev_proto);
let d = w.describe();
print(d);
`;
    const pm = posOf(code, 'describe();');
    const hm = await server.getHover(code, fp('hover-2lv'), pm.line, pm.character);
    expect(text(hm)).toContain('describe');
    expect(text(hm)).toContain('function');
    const pd = posOf(code, 'd = ');
    const hd = await server.getHover(code, fp('hover-2lv-ret'), pd.line, pd.character);
    expect(text(hd)).toContain('string');
  });
});

describe('go-to-definition lands on the prototype member', () => {
  test('direct binding: w.get_name → the get_name key in wdev_proto', async () => {
    const p = posOf(WDEV, 'get_name();');
    const file = fp('def-direct');
    const def = await server.getDefinition(WDEV, file, p.line, p.character + 1);
    expect(def).not.toBeNull();
    const target = posOf(WDEV, 'get_name:');
    expect(def.range.start.line).toBe(target.line);
  });

  test('factory instance: w2.get_name → same key', async () => {
    const p = posOf(WDEV, 'get_name();', 2);
    const def = await server.getDefinition(WDEV, fp('def-fact'), p.line, p.character + 1);
    expect(def).not.toBeNull();
    const target = posOf(WDEV, 'get_name:');
    expect(def.range.start.line).toBe(target.line);
  });
});

describe('signature help on prototype methods', () => {
  test('w.set_config( shows (cfg, flag)', async () => {
    const code = WDEV + 'w.set_config(';
    const lines = code.split('\n');
    const sig = await server.getSignatureHelp(code, fp('sig'), lines.length - 1, 13);
    expect(sig).not.toBeNull();
    expect(sig.signatures[0].label).toContain('set_config');
    expect(sig.signatures[0].label).toContain('cfg');
    expect(sig.signatures[0].label).toContain('flag');
  });
});

describe('`this` is the INSTANCE inside prototype methods', () => {
  test('array instance: shift(this) is LEGAL (was a UC2004 false positive)', async () => {
    const code = `const arr_proto = {\n\tfirst: function() {\n\t\treturn shift(this);\n\t},\n};\nlet a = proto([3, 1, 2], arr_proto);\nprint(a.first());\n`;
    const diags = await server.getDiagnostics(code, fp('this-arr'));
    const uc2004 = diags.filter(d => d.code === 'UC2004');
    expect(uc2004.length).toBe(0);
  });

  test('plain object literal methods keep the OBJECT default: shift(this) still flags', async () => {
    const code = `const plain = {\n\tbad: function() {\n\t\treturn shift(this);\n\t},\n};\nprint(plain.bad());\n`;
    const diags = await server.getDiagnostics(code, fp('this-plain'));
    const uc2004 = diags.filter(d => d.code === 'UC2004');
    expect(uc2004.length).toBe(1);
  });

  test('instance own fields are visible on `this` (this.name → string)', async () => {
    // Pinned indirectly by the n1-hover test; here: no "unknown member"-style
    // noise and no diagnostics on the method body at all.
    const diags = await server.getDiagnostics(WDEV, fp('this-fields'));
    const inBody = diags.filter(d => d.range.start.line >= 3 && d.range.start.line <= 9 && d.severity === 1);
    expect(inBody.length).toBe(0);
  });
});

describe('in-place re-parenting and replacement', () => {
  test('bare `proto(r, P);` statement attaches the chain to an existing binding', async () => {
    const code = WDEV + `let r = { x: 1 };\nproto(r, wdev_proto);\nlet rn = r.get_name();\nprint(rn);\n`;
    const p = posOf(code, 'get_name();', 3);
    const h = await server.getHover(code, fp('reparent'), p.line, p.character);
    expect(text(h)).toContain('get_name');
    expect(text(h)).toContain('function');
  });

  test('a second proto(r, P2) REPLACES the chain (ucode semantics: no merge)', async () => {
    const code = `const p1 = {\n\tfrom_p1: function() {},\n};\nconst p2 = {\n\tfrom_p2: function() {},\n};\nlet r = { x: 1 };\nproto(r, p1);\nproto(r, p2);\nprint(r);\nr.`;
    const lines = code.split('\n');
    const compl = await server.getCompletions(code, fp('replace'), lines.length - 1, 2);
    const ls = labels(compl);
    expect(ls).toContain('from_p2');
    expect(ls).toContain('x'); // own member survives replacement
    expect(ls).not.toContain('from_p1'); // the OLD chain is gone
  });

  test('reassignment stamps too: `s = proto({…}, P)`', async () => {
    const code = `const P = {\n\tm: function() {},\n};\nlet s = null;\ns = proto({ y: 2 }, P);\nprint(s);\ns.`;
    const lines = code.split('\n');
    const compl = await server.getCompletions(code, fp('reassign'), lines.length - 1, 2);
    const ls = labels(compl);
    expect(ls).toContain('m');
    expect(ls).toContain('y');
  });
});

describe('the merged shape feeds existing analyses', () => {
  test('json() readability sees a proto-supplied read() (no UC2017)', async () => {
    const code = `const reader_proto = {\n\tread: function(size) {\n\t\treturn "";\n\t},\n};\nlet src = proto([], reader_proto);\nlet parsed = json(src);\nprint(parsed);\n`;
    const diags = await server.getDiagnostics(code, fp('json-read'));
    const uc2017 = diags.filter(d => d.code === 'UC2017');
    expect(uc2017.length).toBe(0);
  });
});

describe('free functions referenced as prototype methods (the wifi-scripts idiom)', () => {
  const WIFI = `'use strict';

function setup() {
	if (this.state != "up")
		return;
	this.dbg("setup");
	this.state = "setup";
}

function dbg(msg) {
	printf("%s: %s\\n", this.name, msg);
}

const wdev_proto = {
	setup,
	dbg,
};

export function create(name) {
	let wdev = {
		name: name,
		procs: [],
		autostart: true,
		state: "down",
	};
	return proto(wdev, wdev_proto);
}
`;

  test('this.<field> inside the free function types from the instance', async () => {
    const p = posOf(WIFI, 'state != "up"');
    const h = await server.getHover(WIFI, fp('wifi-field'), p.line, p.character + 1);
    expect(text(h)).toContain('string');
  });

  test('this.<method> resolves the sibling table entry with a definition link', async () => {
    const p = posOf(WIFI, 'dbg("setup")');
    const h = await server.getHover(WIFI, fp('wifi-method'), p.line, p.character + 1);
    expect(text(h)).toContain('dbg');
    expect(text(h)).toContain('function');
  });

  test('a free function NOT referenced by any prototype table keeps untyped this', async () => {
    const code = `function lone() {\n\treturn this.whatever;\n}\nprint(lone());\n`;
    const diags = await server.getDiagnostics(code, fp('wifi-lone'));
    // No crash, no spurious member diagnostics.
    const memberErrors = diags.filter(d => String(d.code).startsWith('UC5'));
    expect(memberErrors.length).toBe(0);
  });
});

describe('edge cases: chains, cycles, aliasing, shadowing', () => {
  test('3-level chain: every level resolves in completion', async () => {
    const code = `const l1 = {\n\ta1: function() {},\n};\nconst l2 = proto({\n\ta2: function() {},\n}, l1);\nconst l3 = proto({\n\ta3: function() {},\n}, l2);\nlet w = proto({ own: 1 }, l3);\nprint(w);\nw.`;
    const lines = code.split('\n');
    const ls = labels(await server.getCompletions(code, fp('deep'), lines.length - 1, 2));
    for (const want of ['a1', 'a2', 'a3', 'own']) expect(ls).toContain(want);
  });

  test('CYCLIC re-parenting terminates and both directions resolve', async () => {
    const code = `const A = {\n\tam: function() {},\n};\nconst B = {\n\tbm: function() {},\n};\nproto(A, B);\nproto(B, A);\nlet x = proto({ own: 1 }, A);\nprint(x);\nx.`;
    const lines = code.split('\n');
    const ls = labels(await server.getCompletions(code, fp('cycle'), lines.length - 1, 2));
    for (const want of ['am', 'bm', 'own']) expect(ls).toContain(want);
  });

  test('aliasing: `let w2 = proto(w1, P)` re-parents w1 IN PLACE — both resolve', async () => {
    // Runtime truth: proto() mutates its first operand and returns it; w1 === w2.
    const code = `const P = {\n\tm: function() {},\n};\nlet w1 = { a: 1 };\nlet w2 = proto(w1, P);\nprint(w2);\nw1.`;
    const lines = code.split('\n');
    const ls = labels(await server.getCompletions(code, fp('alias'), lines.length - 1, 3));
    expect(ls).toContain('m');
    expect(ls).toContain('a');
  });

  test('own member SHADOWS a prototype member of the same name (runtime lookup order)', async () => {
    const code = `const P = {\n\tname: function() {},\n};\nlet w = proto({ name: "phy0" }, P);\nlet t = w.name;\nprint(t);\n`;
    const p = posOf(code, 'w.name');
    const h = await server.getHover(code, fp('shadow'), p.line, p.character + 3);
    expect(text(h)).toContain('string');
    expect(text(h)).not.toContain('`function`');
  });

  test('1-arg proto(x) READS the prototype — attaches nothing', async () => {
    const code = `const P = {\n\tm: function() {},\n};\nlet x = { own: 1 };\nlet cur = proto(x);\nprint(cur, P);\nx.`;
    const lines = code.split('\n');
    const ls = labels(await server.getCompletions(code, fp('one-arg'), lines.length - 1, 2));
    expect(ls).toContain('own');
    expect(ls).not.toContain('m');
  });

  test('undefined operands: no crash, UC1001 for both names, no phantom members', async () => {
    const code = `let w = proto(mystery_v, mystery_p);\nprint(w);\n`;
    const diags = await server.getDiagnostics(code, fp('undef'));
    const uc1001 = diags.filter(d => d.code === 'UC1001');
    expect(uc1001.length).toBe(2);
    const ls = labels(await server.getCompletions(code + 'w.', fp('undef2'), 2, 2));
    expect(ls.length).toBe(0);
  });
});

describe('edge cases: `this` typing', () => {
  test('MIXED instances (object + array): shift(this) warns in non-strict', async () => {
    const code = `const P = {\n\tgo: function() {\n\t\treturn shift(this);\n\t},\n};\nlet o = proto({ f: 1 }, P);\nlet a = proto([1], P);\nprint(o, a);\n`;
    const diags = await server.getDiagnostics(code, fp('mixed'));
    const hit = diags.filter(d => d.code === 'nullable-argument');
    expect(hit.length).toBe(1);
    expect(hit[0].severity).not.toBe(1); // warning, not error
  });

  test("MIXED instances under 'use strict': the same diagnostic escalates to an error (existing strict arg policy)", async () => {
    const code = `'use strict';\nconst P = {\n\tgo: function() {\n\t\treturn shift(this);\n\t},\n};\nlet o = proto({ f: 1 }, P);\nlet a = proto([1], P);\nprint(o, a);\n`;
    const diags = await server.getDiagnostics(code, fp('mixed-strict'));
    const hit = diags.filter(d => d.code === 'nullable-argument');
    expect(hit.length).toBe(1);
    expect(hit[0].severity).toBe(1);
  });

  test('this. completion inside a prototype method offers instance fields AND siblings', async () => {
    const code = `const P = {\n\tm: function() {\n\t\treturn this.\n\t},\n};\nlet w = proto({ alpha: 1, beta: "x" }, P);\nprint(w);\n`;
    const ls = labels(await server.getCompletions(code, fp('this-compl'), 2, 14));
    for (const want of ['alpha', 'beta', 'm']) expect(ls).toContain(want);
  });

  test('a table with NO instances keeps the TABLE-shaped this (plain namespace objects unchanged)', async () => {
    const code = `const ns = {\n\thelper: function() {},\n\tmain: function() {\n\t\treturn this.\n\t},\n};\nprint(ns);\n`;
    const ls = labels(await server.getCompletions(code, fp('no-inst'), 3, 15));
    expect(ls).toContain('helper');
    expect(ls).toContain('main');
  });

  test('scope-aware instance resolution: a decoy declarator in another function is ignored', async () => {
    const code = `function decoy() {\n\tlet dev = { state: 42 };\n\tprint(dev);\n}\nfunction setup() {\n\treturn this.state;\n}\nconst P = { setup };\nexport function make() {\n\tlet dev = { state: "down" };\n\treturn proto(dev, P);\n};\n`;
    const p = posOf(code, 'this.state');
    const h = await server.getHover(code, fp('scoped'), p.line, p.character + 6);
    expect(text(h)).toContain('string');
    expect(text(h)).not.toContain('integer');
  });

  test('known-beats-unknown: a constructor-param-fed instance does not swallow a proven field type', async () => {
    const code = `const P = {\n\tget: function() {\n\t\treturn this.tag;\n\t},\n};\nfunction make(t) {\n\treturn proto({ tag: t }, P);\n}\nlet fixed = proto({ tag: "x" }, P);\nlet got = fixed.get();\nprint(got, make);\n`;
    const p = posOf(code, 'got = ');
    const h = await server.getHover(code, fp('kbu'), p.line, p.character + 1);
    expect(text(h)).toContain('string');
  });

  test('ambiguous table name (two block-scoped declarators): no crash, no bogus diagnostics', async () => {
    const code = `function setup() {\n\treturn this.state;\n}\nif (1) {\n\tlet P = { setup };\n\tprint(proto({ state: 1 }, P));\n}\nif (2) {\n\tlet P = { setup };\n\tprint(proto({ state: "s" }, P));\n}\n`;
    const diags = await server.getDiagnostics(code, fp('ambig'));
    expect(diags.filter(d => d.severity === 1).length).toBe(0);
  });
});

describe('edge cases: providers on the free-function table idiom', () => {
  const TABLE = `function setup(mode, force) {\n\tthis.state = mode;\n\treturn force;\n}\nconst P = { setup };\nlet r = proto({ state: "down" }, P);\n`;

  test('signature help resolves params through the shorthand reference', async () => {
    const code = TABLE + 'r.setup(';
    const lines = code.split('\n');
    const sig = await server.getSignatureHelp(code, fp('tbl-sig'), lines.length - 1, 8);
    expect(sig).not.toBeNull();
    expect(sig.signatures[0].label).toContain('mode');
    expect(sig.signatures[0].label).toContain('force');
  });

  test('go-to-definition lands on the table key', async () => {
    const code = TABLE + 'r.setup("up");\n';
    const p = posOf(code, 'r.setup("up")');
    const def = await server.getDefinition(code, fp('tbl-def'), p.line, p.character + 3);
    expect(def).not.toBeNull();
    const key = posOf(code, '{ setup }');
    expect(def.range.start.line).toBe(key.line);
  });

  test('this.<field> WRITE inside the free function is clean', async () => {
    const diags = await server.getDiagnostics(TABLE + 'print(r);\n', fp('tbl-write'));
    expect(diags.filter(d => d.severity === 1).length).toBe(0);
  });
});

describe('edge cases: json() readability through the chain', () => {
  test('a NON-CALLABLE read through the chain is a proven throw (UC2017 error)', async () => {
    const code = `let src = proto([], { read: 5 });\nlet x = json(src);\nprint(x);\n`;
    const diags = await server.getDiagnostics(code, fp('json-bad-read'));
    const uc2017 = diags.filter(d => d.code === 'UC2017' && d.severity === 1);
    expect(uc2017.length).toBe(1);
  });
});

describe('UC8016: cyclic prototype chain (container-proven VM hang on missing-member reads)', () => {
  test('both calls of an A↔B cycle are flagged as warnings', async () => {
    const code = `const A = { am: 1 };\nconst B = { bm: 2 };\nproto(A, B);\nproto(B, A);\nprint(A, B);\n`;
    const diags = await server.getDiagnostics(code, fp('cyc-two'));
    const hits = diags.filter(d => d.code === 'UC8016');
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.severity).toBe(2);
    expect(hits[0].message).toContain('hang');
  });

  test('a self-loop proto(A, A) is flagged', async () => {
    const code = `const A = { am: 1 };\nproto(A, A);\nprint(A);\n`;
    const diags = await server.getDiagnostics(code, fp('cyc-self'));
    expect(diags.filter(d => d.code === 'UC8016').length).toBe(1);
  });

  test('a linear chain is NOT flagged', async () => {
    const code = `const A = { am: 1 };\nconst B = { bm: 2 };\nconst C = { cm: 3 };\nproto(A, B);\nproto(B, C);\nprint(A);\n`;
    const diags = await server.getDiagnostics(code, fp('cyc-linear'));
    expect(diags.filter(d => d.code === 'UC8016').length).toBe(0);
  });

  test('a later re-parent that breaks the cycle un-flags it (runtime REPLACE semantics)', async () => {
    const code = `const A = { am: 1 };\nconst B = { bm: 2 };\nconst C = { cm: 3 };\nproto(A, B);\nproto(B, A);\nproto(B, C);\nprint(A);\n`;
    const diags = await server.getDiagnostics(code, fp('cyc-broken'));
    expect(diags.filter(d => d.code === 'UC8016').length).toBe(0);
  });

  test('a disable directive suppresses it like any diagnostic', async () => {
    const code = `const A = { am: 1 };\nconst B = { bm: 2 };\nproto(A, B); // ucode-lsp disable UC8016\nproto(B, A); // ucode-lsp disable UC8016\nprint(A, B);\n`;
    const diags = await server.getDiagnostics(code, fp('cyc-disable'));
    expect(diags.filter(d => d.code === 'UC8016').length).toBe(0);
  });
});

describe('UC8016 escalation: PROVEN hang reads are errors', () => {
  // ucv_key_get/ucv_property_get walk proto→proto with no cycle guard (reads
  // hang — container-proven); ucv_key_set/ucv_key_delete touch own members
  // only (writes/deletes safe — container-proven). A pre-closure missing read
  // is null, not a hang (container-proven).
  const CYCLE = `const A = { am: 1 };\nconst B = { bm: 2 };\nproto(A, B);\nproto(B, A);\nlet cy = proto({ own: 1 }, A);\n`;
  const uc8016 = (diags) => diags.filter(d => d.code === 'UC8016');
  const errors = (diags) => uc8016(diags).filter(d => d.severity === 1);

  test('an unconditional top-level missing read on the INSTANCE is an error at the read site', async () => {
    const diags = await server.getDiagnostics(CYCLE + 'print(cy.does_not_exist);\n', fp('hang-inst'));
    const errs = errors(diags);
    expect(errs.length).toBe(1);
    expect(errs[0].range.start.line).toBe(5);
    expect(errs[0].message).toContain('hangs the program forever');
    expect(uc8016(diags).length).toBe(3); // + the two closing-call warnings
  });

  test('a missing read on a cycle PARTICIPANT is an error', async () => {
    const diags = await server.getDiagnostics(CYCLE + 'print(A.nope);\n', fp('hang-part'));
    expect(errors(diags).length).toBe(1);
  });

  test('calling a missing METHOD is an error (the callee lookup hangs first)', async () => {
    const diags = await server.getDiagnostics(CYCLE + 'cy.no_such_method();\n', fp('hang-call'));
    expect(errors(diags).length).toBe(1);
  });

  test('present members — chain or own — are clean', async () => {
    const d1 = await server.getDiagnostics(CYCLE + 'print(cy.bm);\n', fp('hang-chain-ok'));
    const d2 = await server.getDiagnostics(CYCLE + 'print(cy.own);\n', fp('hang-own-ok'));
    expect(errors(d1).length).toBe(0);
    expect(errors(d2).length).toBe(0);
  });

  test('WRITES are exempt (ucv_key_set never walks the chain)', async () => {
    const diags = await server.getDiagnostics(CYCLE + 'cy.newprop = 1;\nprint(cy);\n', fp('hang-write'));
    expect(errors(diags).length).toBe(0);
  });

  test('DELETES are exempt (own-member only)', async () => {
    const diags = await server.getDiagnostics(CYCLE + 'delete cy.nothere;\nprint(cy);\n', fp('hang-del'));
    expect(errors(diags).length).toBe(0);
  });

  test('a read BEFORE the cycle closes is exempt (it returns null at runtime)', async () => {
    const code = 'const A = { am: 1 };\nconst B = { bm: 2 };\nproto(A, B);\nprint(A.nope);\nproto(B, A);\nprint(A);\n';
    const diags = await server.getDiagnostics(code, fp('hang-pre'));
    expect(errors(diags).length).toBe(0);
    expect(uc8016(diags).length).toBe(2); // warnings still stand
  });

  test('reads inside functions, ifs, &&, and ternaries are exempt (not provably executed)', async () => {
    for (const [tag, tail] of [
      ['fn', 'function f() {\n\treturn cy.maybe;\n}\nprint(f);\n'],
      ['if', 'if (ARGV[0])\n\tprint(cy.maybe);\n'],
      ['and', 'print(ARGV[0] && cy.maybe);\n'],
      ['tern', 'print(ARGV[0] ? cy.maybe : 1);\n'],
    ]) {
      const diags = await server.getDiagnostics(CYCLE + tail, fp('hang-guard-' + tag));
      expect(errors(diags).length).toBe(0);
    }
  });

  test('a spread in any participant table blocks the proof — warning only', async () => {
    const code = 'const M = { x: 1 };\nconst A = { ...M, am: 1 };\nconst B = { bm: 2 };\nproto(A, B);\nproto(B, A);\nlet cy = proto({ own: 1 }, A);\nprint(cy.does_not_exist);\n';
    const diags = await server.getDiagnostics(code, fp('hang-spread'));
    expect(errors(diags).length).toBe(0);
    expect(uc8016(diags).length).toBe(2);
  });

  test('a CONDITIONALLY-closed cycle blocks the proof — warning only', async () => {
    const code = 'const A = { am: 1 };\nconst B = { bm: 2 };\nproto(A, B);\nif (ARGV[0])\n\tproto(B, A);\nprint(A.nope);\n';
    const diags = await server.getDiagnostics(code, fp('hang-cond-close'));
    expect(errors(diags).length).toBe(0);
  });

  test('the upstream-issue MRE: `let o = {}; proto(o, o); o.x` — warning on the call, error on the read', async () => {
    // Container-proven 2026-08-16: the hang probe stays running (killed after 8s);
    // the control without the read exits 0. docs/cyclic-proto-chain-hang.md.
    const diags = await server.getDiagnostics('let o = {};\nproto(o, o);\nprint(o.x);\n', fp('hang-mre'));
    const hits = uc8016(diags);
    expect(hits.length).toBe(2);
    expect(hits.filter(d => d.severity === 2).length).toBe(1); // the closing call
    const errs = errors(diags);
    expect(errs.length).toBe(1);
    expect(errs[0].range.start.line).toBe(2); // the read
  });

  test('an OPAQUE instance is skipped but participant reads still error', async () => {
    const diags = await server.getDiagnostics(CYCLE + 'let mystery = proto(make_it(), A);\nprint(A.nope, mystery);\n', fp('hang-opaque'));
    expect(errors(diags).length).toBe(1); // A.nope only — mystery.* never flagged
  });
});

describe('UC8016 on ρ shapes: tails into a cycle (tortoise-and-hare)', () => {
  // Container-proven 2026-08-16: a missing read on the TAIL walks a→b→c then
  // loops d→e→f→g forever; members found mid-tail or on the cycle are safe.
  const RHO = `const a = { A: 1 };\nconst b = { B: 1 };\nconst c = { C: 1 };\nconst d = { D: 1 };\nconst e = { E: 1 };\nconst f = { F: 1 };\nconst g = { G: 1 };\nproto(a, b);\nproto(b, c);\nproto(c, d);\nproto(d, e);\nproto(e, f);\nproto(f, g);\nproto(g, d);\n`;
  const uc8016 = (diags) => diags.filter(d => d.code === 'UC8016');
  const errors = (diags) => uc8016(diags).filter(d => d.severity === 1);

  test('warnings sit on the four CYCLE edges only — tail calls are legal chains', async () => {
    const diags = await server.getDiagnostics(RHO + 'print(a);\n', fp('rho-warn'));
    const warns = uc8016(diags).filter(d => d.severity === 2);
    expect(warns.length).toBe(4);
    for (const w of warns) expect(w.range.start.line).toBeGreaterThanOrEqual(10); // proto(d,e) onward
  });

  test('a missing read on the TAIL HEAD is a proven-hang error', async () => {
    const diags = await server.getDiagnostics(RHO + 'print(a.does_not_exist);\n', fp('rho-tail-err'));
    const errs = errors(diags);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain('runs into the cycle');
  });

  test('members found MID-TAIL or on the cycle are clean (first hit terminates the walk)', async () => {
    const d1 = await server.getDiagnostics(RHO + 'print(a.C);\n', fp('rho-mid-ok'));
    const d2 = await server.getDiagnostics(RHO + 'print(a.G);\n', fp('rho-cyc-ok'));
    expect(errors(d1).length).toBe(0);
    expect(errors(d2).length).toBe(0);
  });

  test('an instance attached to a TAIL node: missing errors, own/chain members clean', async () => {
    const bad = await server.getDiagnostics(RHO + 'let w = proto({ own: 1 }, a);\nprint(w.nope);\n', fp('rho-inst-err'));
    expect(errors(bad).length).toBe(1);
    const ok = await server.getDiagnostics(RHO + 'let w = proto({ own: 1 }, a);\nprint(w.C, w.own);\n', fp('rho-inst-ok'));
    expect(errors(ok).length).toBe(0);
  });

  test('a CONDITIONAL tail edge blocks the tail proof (warnings only)', async () => {
    const code = `const a = { A: 1 };\nconst d = { D: 1 };\nconst e = { E: 1 };\nproto(d, e);\nproto(e, d);\nif (ARGV[0])\n\tproto(a, d);\nprint(a.nope);\n`;
    const diags = await server.getDiagnostics(code, fp('rho-cond'));
    expect(errors(diags).length).toBe(0);
    expect(uc8016(diags).length).toBe(2);
  });

  test('joining two cycles is impossible — REPLACE makes one cycle the tail of the other', async () => {
    const code = `const A = { a1: 1 };\nconst B = { b1: 1 };\nconst C = { c1: 1 };\nconst D = { d1: 1 };\nproto(A, B);\nproto(B, A);\nproto(C, D);\nproto(D, C);\nproto(B, C);\nprint(A.nope);\n`;
    const diags = await server.getDiagnostics(code, fp('rho-join'));
    const warns = uc8016(diags).filter(d => d.severity === 2);
    expect(warns.length).toBe(2); // C↔D only — the A↔B "cycle" no longer exists
    for (const w of warns) expect([6, 7]).toContain(w.range.start.line);
    expect(errors(diags).length).toBe(1); // A.nope hangs THROUGH the tail
  });
});

describe('`this` severity tiers by instancing EVIDENCE (shift(this) probe)', () => {
  const BODY = 'go: function() {\n\t\treturn shift(this);\n\t},';
  const argHits = (diags) => diags.filter(d => /UC2004|nullable-argument/.test(String(d.code)));

  test('all-OBJECT instances: hard error (every proven instance mismatches)', async () => {
    const code = 'const t = {\n\t' + BODY + '\n};\nlet a = proto({ x: 1 }, t);\nprint(a.go());\n';
    const hits = argHits(await server.getDiagnostics(code, fp('tier-allobj')));
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe(1);
  });

  test('OPAQUE instance (call result): warning — proto() bounds this to object|array', async () => {
    const code = 'const t = {\n\t' + BODY + '\n};\nlet a = proto(make(), t);\nprint(a.go());\n';
    const hits = argHits(await server.getDiagnostics(code, fp('tier-opaque')));
    expect(hits.length).toBe(1);
    expect(hits[0].severity).not.toBe(1);
  });

  test('member access on union this stays clean (prototype-aware path, no UC5007)', async () => {
    const code = 'const t = {\n\thelper: function() {\n\t\treturn 1;\n\t},\n\tgo: function() {\n\t\treturn this.helper() + this.tag;\n\t},\n};\nlet a = proto({ tag: 1 }, t);\nlet b = proto([2], t);\nprint(a.go(), b);\n';
    const diags = await server.getDiagnostics(code, fp('tier-member'));
    expect(diags.length).toBe(0);
  });

  test('KNOWN HOLE (documented): an exported never-instanced table keeps the OBJECT error', async () => {
    // An importer could attach array instances; softening would require
    // telling prototype tables apart from ordinary exported namespace modules,
    // which same-file evidence cannot do. docs/mixed-instance-this-contracts.md.
    const code = 'export const t = {\n\t' + BODY + '\n};\n';
    const hits = argHits(await server.getDiagnostics(code, fp('tier-exported')));
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe(1);
  });
});

describe('proto() argument contract (lib.c uc_proto + types.c ucv_prototype_set)', () => {
  // uc_proto raises EXCEPTION_TYPE whenever ucv_prototype_set() fails, and that
  // fails unless target is ARRAY|OBJECT *and* prototype is OBJECT. Verified
  // against the interpreter 2026-08-21: proto({},null), proto({},[1,2]),
  // proto({},5), proto(5,{}), proto("str",{}), proto(<fs.file>,{}) ALL throw.
  const argErrs = (diags) => diags.filter(d => /proto/.test(d.message) && d.severity === 1);

  test('a NULL prototype is rejected — proto(x, null) throws, it does not detach', async () => {
    const diags = await server.getDiagnostics('let o = {};\nproto(o, null);\nprint(o);\n', fp('proto-null'));
    expect(argErrs(diags).length).toBe(1);
    expect(argErrs(diags)[0].message).toContain('cannot take null as a prototype');
  });

  test('the idiomatic `proto(ret, proto(this))` stays clean (arg 2 is the object|null read form)', async () => {
    // Every real use of this idiom in the OpenWrt trees (cli/context.uc,
    // context-call.uc, cache.uc) is correct: the receiver always has a
    // prototype. Only a PROVABLY null operand is reported.
    const code = 'const P = {\n\tf: function() {\n\t\tlet ret = {};\n\t\treturn proto(ret, proto(this));\n\t},\n};\nlet i = proto({ x: 1 }, P);\nprint(i.f());\n';
    const diags = await server.getDiagnostics(code, fp('proto-idiom'));
    expect(argErrs(diags).length).toBe(0);
  });

  test('an ARRAY prototype is rejected (the prototype must be an object)', async () => {
    const diags = await server.getDiagnostics('let o = {};\nproto(o, [1]);\nprint(o);\n', fp('proto-arrproto'));
    expect(argErrs(diags).length).toBe(1);
  });

  test('a scalar TARGET is rejected', async () => {
    const diags = await server.getDiagnostics('proto(5, {});\n', fp('proto-scalar'));
    expect(argErrs(diags).length).toBe(1);
  });

  test('valid forms stay clean: object and array targets, 1-arg read on anything', async () => {
    for (const [tag, code] of [
      ['obj', 'let o = {};\nproto(o, { m: 1 });\nprint(o);\n'],
      ['arr', 'let a = [1];\nproto(a, { m: 1 });\nprint(a);\n'],
      ['read', 'let o = {};\nprint(proto(o));\n'],
      ['read-scalar', 'print(proto(5));\n'], // 1-arg tolerates ANY value → null
    ]) {
      const diags = await server.getDiagnostics(code, fp('proto-ok-' + tag));
      expect(argErrs(diags).length).toBe(0);
    }
  });
});

describe('e2e coverage of the resource + nested-chain paths', () => {
  // These paths were previously exercised ONLY by direct-import unit tests,
  // which run in the bun process and never touch the spawned server — so the
  // server-side code was untested end-to-end. Driving them through the LSP.
  const protoErrs = (diags) => diags.filter(d => /proto\(\)/.test(d.message));

  test('resource handle as TARGET is rejected through the server', async () => {
    const code = 'import { open } from "fs";\nlet fh = open("/etc/passwd", "r");\nif (fh) {\n\tproto(fh, { m: 1 });\n}\nprint(fh);\n';
    const errs = protoErrs(await server.getDiagnostics(code, fp('e2e-res-target')));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/cannot attach a prototype to a fs\.file handle/);
  });

  test('resource handle as PROTOTYPE is rejected through the server', async () => {
    const code = 'import { open } from "fs";\nlet fh = open("/etc/passwd", "r");\nlet t = { own: 1 };\nif (fh) {\n\tproto(t, fh);\n}\nprint(t);\n';
    const errs = protoErrs(await server.getDiagnostics(code, fp('e2e-res-proto')));
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/cannot use a fs\.file handle as a prototype/);
  });

  test('a uci.cursor handle is caught too (a different registry entry)', async () => {
    const code = 'import * as uci from "uci";\nlet c = uci.cursor();\nproto(c, { m: 1 });\nprint(c);\n';
    const errs = protoErrs(await server.getDiagnostics(code, fp('e2e-res-uci')));
    expect(errs.some(d => /uci\.cursor handle/.test(d.message))).toBe(true);
  });

  test('a plain DICT from the same module still attaches (fs.stat)', async () => {
    const code = 'import { stat } from "fs";\nlet st = stat("/etc/passwd");\nif (st) {\n\tproto(st, { m: 1 });\n}\nprint(st);\n';
    expect(protoErrs(await server.getDiagnostics(code, fp('e2e-dict-ok'))).length).toBe(0);
  });

  test('nested proto() — `proto(proto(v, A), B)` resolves both layers', async () => {
    const code = 'const A = {\n\tfrom_a: function() {\n\t\treturn "a";\n\t},\n};\nconst B = {\n\tfrom_b: function() {\n\t\treturn "b";\n\t},\n};\nlet w = proto(proto({ own: 1 }, A), B);\nprint(w);\nw.';
    const lines = code.split('\n');
    const ls = labels(await server.getCompletions(code, fp('e2e-nested'), lines.length - 1, 2));
    for (const want of ['from_a', 'from_b', 'own']) expect(ls).toContain(want);
  });

  test('a nested proto() instance keeps the INNER value type (array stays array)', async () => {
    const code = 'const A = {\n\tgo: function() {\n\t\treturn shift(this);\n\t},\n};\nconst B = {\n\tother: function() {\n\t\treturn 1;\n\t},\n};\nlet w = proto(proto([1, 2], A), B);\nprint(w.go());\n';
    const diags = await server.getDiagnostics(code, fp('e2e-nested-arr'));
    expect(diags.filter(d => d.severity === 1).length).toBe(0);
  });

  test('a prototype name whose declarator is NOT an object literal resolves nothing', async () => {
    const code = 'let P = make_proto();\nlet w = proto({ own: 1 }, P);\nprint(w);\nw.';
    const lines = code.split('\n');
    const ls = labels(await server.getCompletions(code, fp('e2e-nonlit'), lines.length - 1, 2));
    expect(ls).toContain('own');       // own members still resolve
    expect(ls).not.toContain('from_a'); // nothing invented from the opaque table
  });

  test('a dead-end chain alongside a real cycle is not treated as a tail', async () => {
    // A→B dead-ends; C↔D is the cycle. Only C and D may be flagged.
    const code = 'const A = { a1: 1 };\nconst B = { b1: 1 };\nconst C = { c1: 1 };\nconst D = { d1: 1 };\nproto(A, B);\nproto(C, D);\nproto(D, C);\nprint(A.nope);\n';
    const diags = await server.getDiagnostics(code, fp('e2e-deadend'));
    const hits = diags.filter(d => d.code === 'UC8016');
    expect(hits.filter(d => d.severity === 2).length).toBe(2); // C↔D only
    expect(hits.filter(d => d.severity === 1).length).toBe(0); // A.nope cannot hang
  });
});
