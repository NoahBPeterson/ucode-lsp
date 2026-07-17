// Reference-equality lint: fresh-literal always-false (UC2009) + reference-identity
// warning (UC2016), across custom objects and every known module handle type.
//
// Ground truth (ucode/types.c ucv_compare + vm.c uc_vm_test_strict_equality, each row
// below independently verified against the `ucode` binary):
//   - two references are equal ONLY when they are the same pointer (same non-scalar
//     type → address compare; strict `===` default case → `v1 == v2`);
//   - a value coerced to a number by `==` yields NaN for every reference/resource
//     (default of ucv_to_number), and NaN equals nothing;
//   => a *fresh* reference literal ({…}, […], function(){}, /re/) has a unique
//      pointer shared with nothing, so ==/=== against it is ALWAYS FALSE (!=/!==
//      always true) — even against an unknown operand;
//   => two reference *variables* of the same kind MAY alias, so a loose `==`/`!=`
//      is a legitimate-but-suspect IDENTITY test (never structural) → UC2016 warning.
//      Key order in an object literal is irrelevant: `{a:1,b:2}` and `{b:2,a:1}` are
//      still two distinct allocations (verified: they compare false).

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/refeq-${n++}.uc`)) || [];
const has = (ds, code) => ds.some(d => d.code === code);
const msgOf = (ds, code) => (ds.find(d => d.code === code) || {}).message || '';

describe('UC2009: a fresh reference literal makes ==/=== always false', () => {
  test('object literal vs object literal', async () => {
    expect(has(await diags('let r = ({a:1} == {a:1});\n'), 'UC2009')).toBe(true);
  });
  test('reordered keys are still distinct allocations (always false)', async () => {
    const ds = await diags('let r = ({a:1,b:2} == {b:2,a:1});\n');
    expect(has(ds, 'UC2009')).toBe(true);
    expect(/always false/.test(msgOf(ds, 'UC2009'))).toBe(true);
  });
  test('variable vs object literal', async () => {
    expect(has(await diags('let o = {a:1};\nlet r = (o == {a:1});\n'), 'UC2009')).toBe(true);
  });
  test('object literal vs variable (symmetry)', async () => {
    expect(has(await diags('let o = {a:1};\nlet r = ({a:1} == o);\n'), 'UC2009')).toBe(true);
  });
  test('array literal vs array literal', async () => {
    expect(has(await diags('let r = ([1,2] == [1,2]);\n'), 'UC2009')).toBe(true);
  });
  test('function expression vs function expression', async () => {
    expect(has(await diags('let r = (function(){} == function(){});\n'), 'UC2009')).toBe(true);
  });
  test('arrow function vs arrow function', async () => {
    expect(has(await diags('let r = ((() => 1) == (() => 2));\n'), 'UC2009')).toBe(true);
  });
  test('regexp literal vs regexp literal', async () => {
    expect(has(await diags('let r = (/x/ == /y/);\n'), 'UC2009')).toBe(true);
  });
  test('strict === against a fresh literal is also always false', async () => {
    expect(has(await diags('let r = ({a:1} === {a:1});\n'), 'UC2009')).toBe(true);
  });
  test('negated != against a fresh literal is always TRUE', async () => {
    const ds = await diags('let o = {a:1};\nlet r = (o != {a:1});\n');
    expect(has(ds, 'UC2009')).toBe(true);
    expect(/always true/.test(msgOf(ds, 'UC2009'))).toBe(true);
  });
  test('SOUND even against an unknown operand (fresh alloc aliases nothing)', async () => {
    expect(has(await diags('function f(x) { return x == {a:1}; }\n'), 'UC2009')).toBe(true);
  });
  test('the message steers to is_equal', async () => {
    expect(/is_equal/.test(msgOf(await diags('let r = ({a:1} == {a:1});\n'), 'UC2009'))).toBe(true);
  });
});

describe('UC2016: two reference VARIABLES compared with loose == test identity, not contents', () => {
  test('object variable == object variable → warning', async () => {
    const ds = await diags('let a = {x:1}, b = {x:1};\nlet r = (a == b);\n');
    expect(has(ds, 'UC2016')).toBe(true);
    expect(has(ds, 'UC2009')).toBe(false);
  });
  test('array variable == array variable → warning', async () => {
    expect(has(await diags('let a = [1], b = [2];\nlet r = (a == b);\n'), 'UC2016')).toBe(true);
  });
  test('function variable == function variable → warning', async () => {
    expect(has(await diags('let a = function(){}, b = function(){};\nlet r = (a == b);\n'), 'UC2016')).toBe(true);
  });
  test('loose != between two object variables → warning', async () => {
    expect(has(await diags('let a = {x:1}, b = {x:1};\nlet r = (a != b);\n'), 'UC2016')).toBe(true);
  });
  test('the warning steers to is_equal', async () => {
    expect(/is_equal/.test(msgOf(await diags('let a = {x:1}, b = {x:1};\nlet r = (a == b);\n'), 'UC2016'))).toBe(true);
  });
  test('strict === between two reference variables ALSO warns (=== is identical to == for references)', async () => {
    const ds = await diags('let a = {x:1}, b = {x:1};\nlet r = (a === b);\n');
    expect(has(ds, 'UC2016')).toBe(true);
    expect(has(ds, 'UC2009')).toBe(false);
  });
  test('strict !== between two reference variables also warns', async () => {
    expect(has(await diags('let a = {x:1}, b = {x:1};\nlet r = (a !== b);\n'), 'UC2016')).toBe(true);
  });
  test('the message frames it as reference-vs-value and notes == and === are identical', async () => {
    const m = msgOf(await diags('let a = {x:1}, b = {x:1};\nlet r = (a === b);\n'), 'UC2016');
    expect(/not their contents/.test(m)).toBe(true);
    expect(/identically on references/.test(m)).toBe(true);
  });
  test('object variable vs array variable (distinct ref kinds) is impossible, not a warning', async () => {
    const ds = await diags('let a = {x:1}, b = [1];\nlet r = (a == b);\n');
    expect(has(ds, 'UC2009')).toBe(true);
    expect(has(ds, 'UC2016')).toBe(false);
  });
});

describe('Known module handle types are references (handle == scalar is always false)', () => {
  // Each handle constructor returns `object | null`. A reference vs a scalar coerces to
  // NaN → always false (UC2009). Imports are UNALIASED — an aliased import currently drops
  // the handle typing (a separate known limitation), which would mask the check.
  const HANDLES = [
    ['socket', "import { create } from 'socket';\nlet h = create(2,1,0);\n"],
    ['ubus',   "import { connect } from 'ubus';\nlet h = connect();\n"],
    ['fs.open',    "import { open } from 'fs';\nlet h = open('/x');\n"],
    ['fs.popen',   "import { popen } from 'fs';\nlet h = popen('cmd');\n"],
    ['fs.opendir', "import { opendir } from 'fs';\nlet h = opendir('/x');\n"],
  ];
  for (const [name, setup] of HANDLES) {
    test(`${name} handle == 5 → UC2009`, async () => {
      expect(has(await diags(`${setup}let r = (h == 5);\n`), 'UC2009')).toBe(true);
    });
    test(`${name} handle == "s" → UC2009`, async () => {
      expect(has(await diags(`${setup}let r = (h == "s");\n`), 'UC2009')).toBe(true);
    });
    test(`${name} handle == {a:1} (fresh literal) → UC2009`, async () => {
      expect(has(await diags(`${setup}let r = (h == {a:1});\n`), 'UC2009')).toBe(true);
    });
  }
  test('handle == handle is SILENT (both object|null → could be null==null or same ref)', async () => {
    const ds = await diags("import { open } from 'fs';\nlet a = open('/x'), b = open('/y');\nlet r = (a == b);\n");
    expect(has(ds, 'UC2009')).toBe(false);
    expect(has(ds, 'UC2016')).toBe(false);
  });
});

describe('is_equal quick fix — rewrite reference == to a structural deep-equal', () => {
  const fixFor = async (code, uri) => {
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const d = ds.find(x => (x.data && x.data.referenceEquality));
    if (!d) return { d: undefined, act: undefined };
    const acts = await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare by value/.test(a.title));
    return { d, act };
  };

  test('fresh-literal UC2009 offers the is_equal rewrite', async () => {
    const { act } = await fixFor('let r = ({a:1} == {a:1});\n', '/tmp/refeq-qf1.uc');
    expect(act).toBeTruthy();
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.some(e => e.newText === 'is_equal({a:1}, {a:1})')).toBe(true);
    // helper is injected because the file has no is_equal of its own
    expect(edits.some(e => /function is_equal/.test(e.newText))).toBe(true);
  });

  test('UC2016 (two object vars) rewrites to is_equal(a, b)', async () => {
    const { act } = await fixFor('let a = {x:1}, b = {x:1};\nlet r = (a == b);\n', '/tmp/refeq-qf2.uc');
    expect(act).toBeTruthy();
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.some(e => e.newText === 'is_equal(a, b)')).toBe(true);
  });

  test('negated != rewrites to !is_equal(a, b)', async () => {
    const { act } = await fixFor('let a = {x:1}, b = {x:1};\nlet r = (a != b);\n', '/tmp/refeq-qf3.uc');
    expect(act).toBeTruthy();
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.some(e => e.newText === '!is_equal(a, b)')).toBe(true);
  });

  test('object-vs-scalar UC2009 carries NO fix (a deep-equal against 5 is nonsense)', async () => {
    const ds = await diags('let r = ({a:1} == 5);\n');
    const d = ds.find(x => x.code === 'UC2009');
    expect(d).toBeTruthy();
    expect(d.data && d.data.referenceEquality).toBeFalsy();
  });

  test('unknown/var vs object literal DOES offer the fix (one side is deep-comparable)', async () => {
    const ds = await diags('function f(cfg) { return cfg == {timeout: 30}; }\n');
    const d = ds.find(x => x.code === 'UC2009');
    expect(d).toBeTruthy();
    expect(d.data && d.data.referenceEquality).toBeTruthy();
  });

  test('regexp comparisons fix by IN-PLACE string coercion (no is_equal helper)', async () => {
    const uri = '/tmp/refeq-re.uc';
    const ds = (await server.getDiagnostics('let r = (/x/ == /y/);\n', uri)) || [];
    const d = ds.find(x => x.code === 'UC2009');
    expect((d.data || {}).referenceEquality && d.data.referenceEquality.coerce).toBe(true);
    const acts = await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare/.test(a.title));
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.length).toBe(1);                                    // no helper inserted
    expect(edits[0].newText).toBe('("" + /x/) == ("" + /y/)');
  });

  test('regexp variables via != coerce with the negated operator', async () => {
    const uri = '/tmp/refeq-re2.uc';
    const ds = (await server.getDiagnostics('let a = /x/, b = /y/;\nlet r = (a != b);\n', uri)) || [];
    const d = ds.find(x => x.code === 'UC2016');
    expect(d && d.data && d.data.referenceEquality.coerce).toBe(true);
    const acts = await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare/.test(a.title));
    expect(act.edit.changes[Object.keys(act.edit.changes)[0]][0].newText).toBe('("" + a) != ("" + b)');
  });

  test('function comparisons carry NO fix (string coercion elides the body → unsound)', async () => {
    const dj = await diags('let r = (function(){} == function(){});\n');   // fresh functions → UC2009, no fix
    expect((dj.find(x => x.code === 'UC2009').data || {}).referenceEquality).toBeFalsy();
    const df = await diags('let a = function(){}, b = function(){};\nlet r = (a == b);\n');
    const w = df.find(x => x.code === 'UC2016');   // still warns, but no is_equal fix
    expect(w).toBeTruthy();
    expect(w.data && w.data.referenceEquality).toBeFalsy();
  });

  test('helper is NOT re-inserted when the file already defines is_equal', async () => {
    const code = 'function is_equal(a,b){ return a===b; }\nlet a = {x:1}, b = {x:1};\nlet r = (a == b);\n';
    const { act } = await fixFor(code, '/tmp/refeq-qf5.uc');
    expect(act).toBeTruthy();
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.length).toBe(1); // only the rewrite, no helper insertion
    expect(edits.some(e => /function is_equal/.test(e.newText))).toBe(false);
  });
});

describe('is_equal quick fix respects ucode no-hoisting (UC1009)', () => {
  // Apply a code action's TextEdits to the source and return the resulting text.
  const posToOffset = (text, pos) => {
    const lines = text.split('\n');
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
    return off + pos.character;
  };
  const applyEdits = (text, edits) => {
    const withOff = edits
      .map(e => ({ newText: e.newText, s: posToOffset(text, e.range.start), en: posToOffset(text, e.range.end) }))
      .sort((a, b) => b.s - a.s); // apply right-to-left so offsets stay valid
    let out = text;
    for (const e of withOff) out = out.slice(0, e.s) + e.newText + out.slice(e.en);
    return out;
  };
  const applyFirstFix = async (code, uri) => {
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const d = ds.find(x => x.data && x.data.referenceEquality);
    const acts = await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare by value/.test(a.title));
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    return applyEdits(code, edits);
  };

  test('is_equal already in the file → fix REUSES it, never injects a second copy', async () => {
    const uri = '/tmp/refeq-hoist1.uc';
    // is_equal defined below the use — the fix must still rewrite to is_equal (theirs), with NO
    // inserted helper and NO renamed clone (a duplicate would be a strict redeclaration).
    const code = 'let a = {x:1}, b = {x:1};\nlet r = (a == b);\nfunction is_equal(x,y){ return x === y; }\n';
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const d = ds.find(x => x.data && x.data.referenceEquality);
    const acts = await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare by value/.test(a.title));
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.length).toBe(1);                                        // rewrite only — no insertion
    expect(edits[0].newText).toBe('is_equal(a, b)');                     // reuses theirs, no deep_equal clone
    expect(edits.some(e => /function/.test(e.newText))).toBe(false);     // nothing new injected
  });

  test('is_equal defined ABOVE the use → fix does NOT inject a duplicate', async () => {
    const code = 'function is_equal(x,y){ return x === y; }\nlet a = {x:1}, b = {x:1};\nlet r = (a == b);\n';
    const ds = (await server.getDiagnostics(code, '/tmp/refeq-hoist2.uc')) || [];
    const d = ds.find(x => x.data && x.data.referenceEquality);
    const acts = await server.getCodeActions('/tmp/refeq-hoist2.uc', [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare by value/.test(a.title));
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.length).toBe(1); // rewrite only, no helper insertion
  });

  test('applying the fix with no prior is_equal yields a clean file', async () => {
    const fixed = await applyFirstFix('let a = {x:1}, b = {x:1};\nlet r = (a == b);\n', '/tmp/refeq-hoist3.uc');
    const ds = (await server.getDiagnostics(fixed, '/tmp/refeq-hoist3b.uc')) || [];
    expect(ds.some(x => x.code === 'UC1009')).toBe(false);
    expect(ds.some(x => x.code === 'UC2009' || x.code === 'UC2016')).toBe(false);
    expect(/function is_equal/.test(fixed)).toBe(true);
  });
});

describe('Soundness — cases that must NOT be flagged', () => {
  test('o == null is owned by the null-safety engine (silent here)', async () => {
    const ds = await diags('let o = {a:1};\nlet r = (o == null);\n');
    expect(has(ds, 'UC2009')).toBe(false);
    expect(has(ds, 'UC2016')).toBe(false);
  });
  test('type(x) == "object" is a type-guard, not a value comparison', async () => {
    expect(has(await diags('function f(x){ return type(x) == "object"; }\n'), 'UC2009')).toBe(false);
  });
  test('two scalar variables of the same type → silent', async () => {
    const ds = await diags('let a = 5, b = 6;\nlet r = (a == b);\n');
    expect(has(ds, 'UC2009')).toBe(false);
    expect(has(ds, 'UC2016')).toBe(false);
  });
});
