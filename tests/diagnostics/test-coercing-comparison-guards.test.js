// Coercing comparisons are not type guards (docs/type-soundness-audit.md N-1 + N-3).
// Oracle-verified semantics (identical on /usr/local/bin/ucode and master):
//   ==  coerces among scalars (0=="0", ""==false, "1"==true, 1==1.0 all TRUE) but is
//       pure IDENTITY for references ([1]==[1] false, /x/==/x/ false) and null only
//       equals null. So `x == y` proves x's type ONLY when every member of y's type
//       is reference-exact (array/object/function/regex/null).
//   <,> null behaves exactly as 0 (null<5 true, null>0 false), numeric strings and
//       bools coerce ("10">5, true>0 true), and references ALWAYS compare false
//       ([]<5, {}<5, f<5, /x/<5 all false). So a true numeric comparison never
//       proves integer|double - it only removes reference types, plus null when
//       the op/literal combo excludes 0.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/coerce-${n++}.uc`)) || [];
const hover = async (code, line, ch) => {
  const h = await server.getHover(code, `/tmp/coerce-${n++}.uc`, line, ch);
  const c = h?.contents;
  return typeof c === 'string' ? c : (c?.value ?? JSON.stringify(c ?? ''));
};

describe('N-1: loose == against a SCALAR proves nothing', () => {
  test('== integer variable: the branch must not claim definite integer', async () => {
    // Runtime: f("5") enters the branch holding a STRING ("5" == 5 is true).
    const text = await hover(
      'function f(xx) {\n' +
      '    let yy = 5;\n' +
      '    if (xx == yy) {\n' +
      '        return xx;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f("5"), "\\n");\n', 3, 16);
    expect(text.includes('`integer`')).toBe(false);
  });

  test('== numeric-string variable: the branch must not claim definite string', async () => {
    // Runtime: f(0) enters the branch holding an INTEGER (0 == "0" is true).
    const text = await hover(
      'function f(xx) {\n' +
      '    let yy = "0";\n' +
      '    if (xx == yy) {\n' +
      '        return xx;\n' +
      '    }\n' +
      '    return 1;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 3, 16);
    expect(text.includes('`string`')).toBe(false);
  });

  test('!= scalar early-return: the fall-through must not narrow either', async () => {
    const text = await hover(
      'function f(xx) {\n' +
      '    let yy = 5;\n' +
      '    if (xx != yy)\n' +
      '        return 0;\n' +
      '    return xx;\n' +
      '}\n' +
      'print(f("5"), "\\n");\n', 4, 12);
    expect(text.includes('`integer`')).toBe(false);
  });
});

describe('N-1: sound equality guards keep working', () => {
  test('strict === against a scalar variable still narrows', async () => {
    // ucode === is same-type only (1 === 1.0 is FALSE) - a true edge proves the type.
    const text = await hover(
      'function f(xx) {\n' +
      '    let yy = 5;\n' +
      '    if (xx === yy) {\n' +
      '        return xx;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(5), "\\n");\n', 3, 16);
    expect(text).toContain('integer');
  });

  test('loose == against an ARRAY variable still narrows (identity semantics)', async () => {
    // [1]==[1] is false; == on a reference is pointer identity, so a true edge
    // proves xx IS that array.
    const ds = await diags(
      'function f(xx) {\n' +
      '    let yy = [1];\n' +
      '    if (xx == yy) {\n' +
      '        push(xx, 2);\n' +
      '    }\n' +
      '    return xx;\n' +
      '}\n' +
      'print(f([1]), "\\n");\n');
    expect(ds.some(d => d.code === 'UC2004')).toBe(false);
  });

  test('loose == against an OBJECT variable still narrows', async () => {
    const text = await hover(
      'function f(xx) {\n' +
      '    let yy = { port: 1 };\n' +
      '    if (xx == yy) {\n' +
      '        return xx;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f(null), "\\n");\n', 3, 16);
    expect(text).toContain('object');
  });

  test('loose == against array|null union (all reference-exact) still narrows', async () => {
    const text = await hover(
      'function f(cc, xx) {\n' +
      '    let yy = cc ? [1] : null;\n' +
      '    if (xx == yy) {\n' +
      '        return xx;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(1, [1]), "\\n");\n', 3, 16);
    expect(text).toContain('array');
  });

  test('loose == against string|array union (mixed) does NOT narrow', async () => {
    const text = await hover(
      'function f(cc, xx) {\n' +
      '    let yy = cc ? "s" : [1];\n' +
      '    if (xx == yy) {\n' +
      '        return xx;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(0, [1]), "\\n");\n', 3, 16);
    expect(text.includes('`string | array`')).toBe(false);
    expect(text.includes('`array | string`')).toBe(false);
  });

  test('== null check is sound (null only loose-equals null) and keeps working', async () => {
    const ds = await diags(
      'function f(cc) {\n' +
      '    let vv = cc ? [1] : null;\n' +
      '    if (vv == null)\n' +
      '        return 0;\n' +
      '    return vv[0];\n' +
      '}\n' +
      'print(f(1), "\\n");\n');
    expect(ds.filter(d => d.code === 'UC5005' || d.code === 'UC5006')).toEqual([]);
  });
});

describe('N-3: numeric guards fabricate exactly the SOUND passable set', () => {
  test('unknown param > 5: integer | double | string (bools drop: neither 0 nor 1 beats 5)', async () => {
    // "10" > 5 is TRUE (numeric strings coerce), so string must stay in;
    // true>5 and false>5 are FALSE, so boolean is provably excluded, as is
    // null (0 > 5 false). f("10") lands in the branch holding a string.
    const text = await hover(
      'function f(pp) {\n' +
      '    if (pp > 5) {\n' +
      '        return pp;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f("10"), "\\n");\n', 2, 16);
    expect(text).toContain('integer | double | string');
    expect(text.includes('boolean')).toBe(false);
    expect(text.includes('null')).toBe(false);
  });

  test('unknown param > 0: boolean joins (true is 1, 1 > 0), null still out', async () => {
    const text = await hover(
      'function f(pp) {\n' +
      '    if (pp > 0) {\n' +
      '        return pp;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f(true), "\\n");\n', 2, 16);
    expect(text).toContain('boolean');
    expect(text.includes('null')).toBe(false);
  });

  test('unknown param >= 0: everything scalar passes (null is 0) - only references excluded', async () => {
    const text = await hover(
      'function f(pp) {\n' +
      '    if (pp >= 0) {\n' +
      '        return pp;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f(null), "\\n");\n', 2, 16);
    expect(text).toContain('boolean');
    expect(text).toContain('null');
    expect(text.includes('array')).toBe(false);
  });

  test('integer|string union survives a numeric guard (numeric strings pass)', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? 10 : "20";\n' +
      '    if (vv > 5) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 3, 16);
    expect(text).toContain('string');
  });

  test('boolean member of a known union drops when neither 0 nor 1 passes', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? true : 10;\n' +
      '    if (vv > 5) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 3, 16);
    expect(text).toContain('integer');
    expect(text.includes('boolean')).toBe(false);
  });
});

describe('N-3: the sound residue - removing null and references', () => {
  test('vv > 0 excludes null (null coerces to 0; 0 > 0 is false)', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? 5 : null;\n' +
      '    if (vv > 0) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(1), "\\n");\n', 3, 16);
    expect(text).toContain('integer');
    expect(text.includes('null')).toBe(false);
  });

  test('vv >= 0 KEEPS null (0 >= 0 is true - null passes)', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? 5 : null;\n' +
      '    if (vv >= 0) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 3, 16);
    expect(text).toContain('null');
  });

  test('vv < 0 excludes null (0 < 0 is false)', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? -5 : null;\n' +
      '    if (vv < 0) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(1), "\\n");\n', 3, 16);
    expect(text.includes('null')).toBe(false);
  });

  test('references cannot pass a numeric comparison: array|integer > 2 is integer', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? [1] : 5;\n' +
      '    if (vv > 2) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 3, 16);
    expect(text).toContain('integer');
    expect(text.includes('array')).toBe(false);
  });

  test('literal on the LEFT flips the operator: 0 < vv excludes null', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? 5 : null;\n' +
      '    if (0 < vv) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(1), "\\n");\n', 3, 16);
    expect(text.includes('null')).toBe(false);
  });

  test('literal on the LEFT, mirrored keep-case: 0 <= vv keeps null', async () => {
    const text = await hover(
      'function f(cc) {\n' +
      '    let vv = cc ? 5 : null;\n' +
      '    if (0 <= vv) {\n' +
      '        return vv;\n' +
      '    }\n' +
      '    return 0;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 3, 16);
    expect(text).toContain('null');
  });
});
