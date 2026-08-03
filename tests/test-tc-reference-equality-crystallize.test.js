// Crystallization suite for the reference-equality lint — 50+ distinct behaviours across every
// comparison operator (==, !=, ===, !==) against every kind of value, including the builtin
// module handle types. Each row is grounded in ucode's runtime semantics (types.c ucv_compare +
// vm.c uc_vm_test_strict_equality), independently verified against the `ucode` binary:
//
//   · references compare by POINTER identity (same non-scalar type → addr compare; strict default
//     → v1 == v2). `==` and `===` are IDENTICAL on references. A fresh literal aliases nothing, so
//     it is always-unequal to everything → UC2009. A reference coerces to NaN vs a scalar → never
//     equal → UC2009. Two reference variables may alias → UC2016 (by reference, not value).
//   · module handle constructors return `object | null` (a reference), so `handle <op> scalar` is
//     always false; `handle <op> handle` is silent (could be null == null).
//
// Codes: UC2009 = impossible (error), UC2016 = reference comparison (warning),
//        UC2015 = coercing scalar equality (warning, shown for contrast).

// NOTE (0.7.90): each snippet ends with `print(a, b);` — without another
// occurrence, two sole-use fresh-literal variables now get the STRONGER
// UC2009 always-false lint (see test-unshared-fresh-reference-compare) and
// would never reach the UC2016 / quick-fix paths these suites pin.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/refx-${n++}.uc`)) || [];
const has = (ds, code) => ds.some(d => d.code === code);
const msgOf = (ds, code) => (ds.find(d => d.code === code) || {}).message || '';
// Classify a single comparison `(a <op> b)` in a function body (so `{`-literals parse as objects).
const classify = async (expr) => {
  const ds = await diags(`function f(cfg, x) { return ${expr}; }\n`);
  if (has(ds, 'UC2009')) return 'UC2009';
  if (has(ds, 'UC2016')) return 'UC2016';
  if (has(ds, 'UC2015')) return 'UC2015';
  return 'none';
};
const fixData = async (expr) => {
  const ds = await diags(`function f(cfg, x) { return ${expr}; }\n`);
  const d = ds.find(z => z.data && z.data.referenceEquality);
  return d ? d.data.referenceEquality : null;
};

// ───────────────────────────────────────────────────────────────────────────
describe('1. every operator on two OBJECT variables → UC2016 (by reference)', () => {
  const setup = 'let a = {p:1}, b = {p:1};';
  const cases = [['==', 1], ['!=', 2], ['===', 3], ['!==', 4]];
  for (const [op] of cases) {
    test(`a ${op} b → UC2016`, async () => {
      expect(has(await diags(`${setup}\nlet r = (a ${op} b);\nprint(a, b);\n`), 'UC2016')).toBe(true);
    });
  }
  test('the message says "not their contents" and notes == and === are identical', async () => {
    const m = msgOf(await diags(`${setup}\nlet r = (a === b);\nprint(a, b);\n`), 'UC2016');
    expect(/not their contents/.test(m) && /identically on references/.test(m)).toBe(true);
  });
});

describe('2. every operator on two ARRAY variables → UC2016', () => {
  for (const op of ['==', '!=', '===', '!==']) {
    test(`arr ${op} arr → UC2016`, async () => {
      expect(has(await diags(`let a = [1], b = [2];\nlet r = (a ${op} b);\nprint(a, b);\n`), 'UC2016')).toBe(true);
    });
  }
});

describe('3. FUNCTION variables → UC2016 but NO fix (string coercion elides the body)', () => {
  for (const op of ['==', '===']) {
    test(`func ${op} func → UC2016, no fix`, async () => {
      const ds = await diags(`let a = function(){}, b = function(){};\nlet r = (a ${op} b);\nprint(a, b);\n`);
      const w = ds.find(d => d.code === 'UC2016');
      expect(w).toBeTruthy();
      expect(w.data && w.data.referenceEquality).toBeFalsy();
    });
  }
});

describe('4. REGEXP variables → UC2016 with an in-place string-coercion fix', () => {
  for (const op of ['==', '!=', '===', '!==']) {
    test(`regex ${op} regex → UC2016 + coerce fix`, async () => {
      const ds = await diags(`let a = /x/, b = /y/;\nlet r = (a ${op} b);\nprint(a, b);\n`);
      const w = ds.find(d => d.code === 'UC2016');
      expect(w && w.data && w.data.referenceEquality && w.data.referenceEquality.coerce).toBe(true);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
describe('5. FRESH literals — every kind × operator → UC2009 (aliases nothing)', () => {
  test('{a:1} == {a:1} → always false', async () => expect(await classify('{a:1} == {a:1}')).toBe('UC2009'));
  test('{a:1} === {a:1} → always false', async () => expect(await classify('{a:1} === {a:1}')).toBe('UC2009'));
  test('{a:1} != {a:1} → always TRUE', async () => {
    expect(/always true/.test(msgOf(await diags('function f(){ return {a:1} != {a:1}; }\n'), 'UC2009'))).toBe(true);
  });
  test('{a:1} !== {a:1} → always TRUE', async () => {
    expect(/always true/.test(msgOf(await diags('function f(){ return {a:1} !== {a:1}; }\n'), 'UC2009'))).toBe(true);
  });
  test('[1,2] == [1,2] → always false', async () => expect(await classify('[1,2] == [1,2]')).toBe('UC2009'));
  test('[1] === [2] → always false', async () => expect(await classify('[1] === [2]')).toBe('UC2009'));
  test('function(){} == function(){} → always false', async () => expect(await classify('function(){} == function(){}')).toBe('UC2009'));
  test('arrow () => 1 == () => 2 → always false', async () => expect(await classify('(() => 1) == (() => 2)')).toBe('UC2009'));
  test('/x/ == /y/ → always false', async () => expect(await classify('/x/ == /y/')).toBe('UC2009'));
  test('/x/ === /y/ → always false', async () => expect(await classify('/x/ === /y/')).toBe('UC2009'));
  test('reordered keys {a:1,b:2} == {b:2,a:1} → always false', async () => expect(await classify('{a:1,b:2} == {b:2,a:1}')).toBe('UC2009'));
  test('nested {a:{b:1}} == {a:{b:1}} → always false', async () => expect(await classify('{a:{b:1}} == {a:{b:1}}')).toBe('UC2009'));
});

describe('6. FRESH literal vs a variable / unknown (still always-false, sound)', () => {
  test('cfg == {timeout:30} → UC2009', async () => expect(await classify('cfg == {timeout:30}')).toBe('UC2009'));
  test('{timeout:30} == cfg (symmetric) → UC2009', async () => expect(await classify('{timeout:30} == cfg')).toBe('UC2009'));
  test('x == {a:1} (unknown) → UC2009', async () => expect(await classify('x == {a:1}')).toBe('UC2009'));
  test('x == [1] (unknown vs array) → UC2009', async () => expect(await classify('x == [1]')).toBe('UC2009'));
  test('x != {a:1} → always TRUE', async () => {
    expect(/always true/.test(msgOf(await diags('function f(x){ return x != {a:1}; }\n'), 'UC2009'))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('7. reference vs SCALAR → UC2009 (coerces to NaN, never equal), no fix', () => {
  test('obj == 5', async () => expect(await classify('({p:1}) == 5')).toBe('UC2009'));
  test('obj === 5', async () => expect(await classify('({p:1}) === 5')).toBe('UC2009'));
  test('obj != 5 → always TRUE', async () => {
    expect(/always true/.test(msgOf(await diags('function f(){ return ({p:1}) != 5; }\n'), 'UC2009'))).toBe(true);
  });
  test('arr == "x"', async () => expect(await classify('[1] == "x"')).toBe('UC2009'));
  test('arr === "x"', async () => expect(await classify('[1] === "x"')).toBe('UC2009'));
  test('obj == true', async () => expect(await classify('({p:1}) == true')).toBe('UC2009'));
  test('arr == 0', async () => expect(await classify('[1] == 0')).toBe('UC2009'));
  test('reference-vs-scalar carries NO is_equal fix', async () => {
    expect(await fixData('({p:1}) == 5')).toBeNull();
  });
});

describe('8. distinct reference KINDS → UC2009 (different pointers, never equal)', () => {
  test('obj var == arr var', async () => {
    expect(has(await diags('let a = {p:1}, b = [1];\nlet r = (a == b);\nprint(a, b);\n'), 'UC2009')).toBe(true);
  });
  test('obj var === arr var', async () => {
    expect(has(await diags('let a = {p:1}, b = [1];\nlet r = (a === b);\nprint(a, b);\n'), 'UC2009')).toBe(true);
  });
  test('fresh {a:1} == [1] (cross-kind literals)', async () => expect(await classify('{a:1} == [1]')).toBe('UC2009'));
  test('function var == regex var', async () => {
    expect(has(await diags('let a = function(){}, b = /x/;\nlet r = (a == b);\nprint(a, b);\n'), 'UC2009')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Every builtin module handle constructor returns `object | null` (a reference).
const HANDLES = [
  ['fs.open',       "import { open } from 'fs';\nlet h = open('/x');\n"],
  ['fs.popen',      "import { popen } from 'fs';\nlet h = popen('x');\n"],
  ['fs.opendir',    "import { opendir } from 'fs';\nlet h = opendir('/x');\n"],
  ['fs.mkstemp',    "import { mkstemp } from 'fs';\nlet h = mkstemp();\n"],
  ['fs.fdopen',     "import { fdopen } from 'fs';\nlet h = fdopen(0, 'r');\n"],
  ['socket.create', "import { create } from 'socket';\nlet h = create(2,1,0);\n"],
  ['socket.connect',"import { connect } from 'socket';\nlet h = connect('x');\n"],
  ['ubus.connect',  "import { connect } from 'ubus';\nlet h = connect();\n"],
  ['rtnl.listener', "import { listener } from 'rtnl';\nlet h = listener(1, () => 1);\n"],
  ['uloop.timer',   "import { timer } from 'uloop';\nlet h = timer(100, () => 1);\n"],
];

describe('9. every builtin module handle is a reference: handle == 5 → UC2009', () => {
  for (const [name, setup] of HANDLES) {
    test(`${name} handle == 5`, async () => {
      expect(has(await diags(`${setup}let r = (h == 5);\n`), 'UC2009')).toBe(true);
    });
  }
});

describe('10. module handles across operators / scalar kinds', () => {
  const fs = "import { open } from 'fs';\nlet h = open('/x');\n";
  test('handle === 5 (strict) → UC2009', async () => expect(has(await diags(`${fs}let r = (h === 5);\n`), 'UC2009')).toBe(true));
  test('handle != 5 → always TRUE', async () => {
    expect(/always true/.test(msgOf(await diags(`${fs}let r = (h != 5);\n`), 'UC2009'))).toBe(true);
  });
  test('handle !== 5 → always TRUE', async () => {
    expect(/always true/.test(msgOf(await diags(`${fs}let r = (h !== 5);\n`), 'UC2009'))).toBe(true);
  });
  test('handle == "" (string) → UC2009', async () => expect(has(await diags(`${fs}let r = (h == "");\n`), 'UC2009')).toBe(true));
  test('handle == true (bool) → UC2009', async () => expect(has(await diags(`${fs}let r = (h == true);\n`), 'UC2009')).toBe(true));
  test('handle == {fd:3} (fresh literal) → UC2009 + is_equal fix', async () => {
    const ds = await diags(`${fs}let r = (h == {fd:3});\n`);
    const d = ds.find(z => z.code === 'UC2009');
    expect(d && d.data && d.data.referenceEquality).toBeTruthy();
  });
});

describe('11. two module handles compared → SILENT (object|null: could be null==null)', () => {
  const two = "import { open } from 'fs';\nlet a = open('/x'), b = open('/y');\n";
  test('handle == handle → silent', async () => {
    const ds = await diags(`${two}let r = (a == b);\nprint(a, b);\n`);
    expect(has(ds, 'UC2009') || has(ds, 'UC2016')).toBe(false);
  });
  test('handle === handle → silent', async () => {
    const ds = await diags(`${two}let r = (a === b);\nprint(a, b);\n`);
    expect(has(ds, 'UC2009') || has(ds, 'UC2016')).toBe(false);
  });
  test('handle == null → silent (owned by null-safety)', async () => {
    const ds = await diags("import { open } from 'fs';\nlet a = open('/x');\nlet r = (a == null);\n");
    expect(has(ds, 'UC2009') || has(ds, 'UC2016')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('12. quick-fix SHAPE differs by operand kind', () => {
  const fixOf = async (code, uri) => {
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const d = ds.find(x => x.data && x.data.referenceEquality);
    const acts = await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character);
    const act = (acts || []).find(a => /Compare/.test(a.title));
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    return { title: act.title, newText: edits[0].newText, count: edits.length };
  };
  test('object → is_equal(a, b) + helper insertion', async () => {
    const f = await fixOf('let a = {p:1}, b = {p:1};\nlet r = (a == b);\nprint(a, b);\n', '/tmp/refx-fo.uc');
    expect(f.newText).toBe('is_equal(a, b)');
    expect(f.count).toBe(2);
  });
  test('negated object → !is_equal(a, b)', async () => {
    const f = await fixOf('let a = {p:1}, b = {p:1};\nlet r = (a !== b);\nprint(a, b);\n', '/tmp/refx-fn.uc');
    expect(f.newText).toBe('!is_equal(a, b)');
  });
  test('regexp → in-place ("" + a) == ("" + b), no helper', async () => {
    const f = await fixOf('let a = /x/, b = /y/;\nlet r = (a == b);\nprint(a, b);\n', '/tmp/refx-fr.uc');
    expect(f.newText).toBe('("" + a) == ("" + b)');
    expect(f.count).toBe(1);
  });
  test('regexp negated → ("" + a) != ("" + b)', async () => {
    const f = await fixOf('let a = /x/, b = /y/;\nlet r = (a !== b);\nprint(a, b);\n', '/tmp/refx-frn.uc');
    expect(f.newText).toBe('("" + a) != ("" + b)');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('13. DELIBERATELY SILENT / not a reference comparison', () => {
  test('obj == null → silent (null-safety owns it)', async () => expect(await classify('({p:1}) == null')).toBe('none'));
  test('obj === null → silent', async () => expect(await classify('({p:1}) === null')).toBe('none'));
  test('obj != null → silent', async () => expect(await classify('({p:1}) != null')).toBe('none'));
  test('type(o) == "object" → silent (type guard, not value compare)', async () => {
    expect(has(await diags('function f(o){ return type(o) == "object"; }\n'), 'UC2009')).toBe(false);
  });
  test('int == int (scalars) → silent', async () => {
    const ds = await diags('let a = 5, b = 6;\nlet r = (a == b);\nprint(a, b);\n');
    expect(has(ds, 'UC2009') || has(ds, 'UC2016')).toBe(false);
  });
  test('unknown == unknown → silent (never mis-flag dynamic)', async () => {
    expect(await classify('cfg == x')).toBe('none');
  });
  test('int == "5" → UC2015 coercing, NOT a reference diagnostic', async () => {
    const ds = await diags('let a = 5;\nlet r = (a == "5");\n');
    expect(has(ds, 'UC2015')).toBe(true);
    expect(has(ds, 'UC2016') || has(ds, 'UC2009')).toBe(false);
  });
  test('string == string (scalars) → silent', async () => {
    expect(await classify('"a" == "b"')).toBe('none');
  });
});
