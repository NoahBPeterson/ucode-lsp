// Type-soundness campaign (docs/type-soundness-audit.md): a definite `T` must not
// be claimed where the honest type is `T | unknown` or `T | null`. Every crash
// shape here is oracle-verified: the runtime really does die on the path the old
// types said was safe.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/tsc-${n++}.uc`)) || [];
const hover = async (code, line, ch) => {
  const h = await server.getHover(code, `/tmp/tsc-${n++}.uc`, line, ch);
  return JSON.stringify(h?.contents ?? '');
};
const codesOf = (ds) => ds.map(d => d.code);

describe('I-1: conditional identifier writes keep the fall-through type', () => {
  test('post-if read of a conditionally-written let is union, and the null deref WARNS', async () => {
    // Runtime: f(0) crashes ("left-hand side expression is null"). Was silent.
    const ds = await diags(
      'function f(c) {\n' +
      '    let v;\n' +
      '    if (c) v = { a: 1 };\n' +
      '    return v.a;\n' +
      '}\n' +
      'print(f(1), "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);   // may-null warning
    expect(ds.some(d => d.code === 'UC5005')).toBe(false);  // not a hard definite-null
  });

  test('conditionally-reassigned param hovers as union, not definite', async () => {
    const text = await hover(
      'function f(x) {\n' +
      '    if (x == "go") x = [1];\n' +
      '    return x;\n' +
      '}\n' +
      'print(f("go"), "\\n");\n', 2, 11);
    expect(text).toContain('array');
    expect(text).toContain('unknown');
  });

  test('mirror FP: conditional null write is may-null, not provably-null', async () => {
    // Runtime: f(1) returns 1 fine - the UC5005 hard error was a false positive.
    const ds = await diags(
      'function f(c) {\n' +
      '    let x = { foo: 1 };\n' +
      '    if (c) x = null;\n' +
      '    return x.foo;\n' +
      '}\n' +
      'print(f(0), "\\n");\n');
    expect(ds.some(d => d.code === 'UC5005')).toBe(false);
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);
  });

  test('unconditional write stays definite (no union noise)', async () => {
    const text = await hover(
      'function f(x) {\n' +
      '    x = [1];\n' +
      '    return x;\n' +
      '}\n' +
      'print(f(0), "\\n");\n', 2, 11);
    expect(text).toContain('array');
    expect(text).not.toContain('unknown');
  });
});

describe('I-4: non-if conditional contexts get branch treatment', () => {
  test('function-body member write no longer poisons outer reads (live UC2015 FP)', async () => {
    // Runtime prints "default"; UC2015 claimed cfg.mode is definitely string.
    const ds = await diags(
      'let cfg = { mode: 0 };\n' +
      'function reset() { cfg.mode = "off"; }\n' +
      'if (cfg.mode == 0) print("default", "\\n");\n' +
      'reset();\n');
    expect(ds.some(d => d.code === 'UC2015')).toBe(false);
  });

  test('switch-case member write does not claim definite for later reads', async () => {
    const ds = await diags(
      'function f(k) {\n' +
      '    let o = {};\n' +
      '    switch (k) { case 1: o.v = [1]; break; }\n' +
      '    if (o.v == "x") return 1;\n' +
      '    return 2;\n' +
      '}\n' +
      'print(f(0), "\\n");\n');
    expect(ds.some(d => d.code === 'UC2009')).toBe(false);
  });

  test('ternary-arm identifier write does not claim definite', async () => {
    const ds = await diags(
      'function f(c, x) {\n' +
      '    c ? (x = [1]) : 0;\n' +
      '    if (x == "s") return 1;\n' +
      '    return 2;\n' +
      '}\n' +
      'print(f(0, "s"), "\\n");\n');
    expect(ds.some(d => d.code === 'UC2009')).toBe(false);
  });

  test('&&-RHS identifier write does not claim definite', async () => {
    const ds = await diags(
      'function f(c, x) {\n' +
      '    c && (x = [1]);\n' +
      '    if (x == "s") return 1;\n' +
      '    return 2;\n' +
      '}\n' +
      'print(f(0, "s"), "\\n");\n');
    expect(ds.some(d => d.code === 'UC2009')).toBe(false);
  });
});

describe('I-4b: function-body writes are call-position gated', () => {
  test('a read BEFORE the fn is ever referenced keeps the pristine type', async () => {
    // reset is only DEFINED above the read - nothing can have called it yet.
    const text = await hover(
      'let cfg = { mode: 0 };\n' +
      'function reset() { cfg.mode = "off"; }\n' +
      'if (cfg.mode == 0) print("default", "\\n");\n' +
      'reset();\n', 2, 9);
    expect(text).toContain('integer');
    expect(text).not.toContain('string');
  });

  test('a read after an UNCONDITIONAL call sees the written type, definite', async () => {
    // reset() at top level definitely ran, and its write is unconditional within
    // the body - so cfg.mode IS "off" here, not a union.
    const text = await hover(
      'let cfg = { mode: 0 };\n' +
      'function reset() { cfg.mode = "off"; }\n' +
      'reset();\n' +
      'if (cfg.mode == 0) print("maybe", "\\n");\n', 3, 9);
    expect(text).toContain('string');
    expect(text).not.toContain('integer');
  });

  test('a read after a CONDITIONAL call still sees the union', async () => {
    const text = await hover(
      'let cfg = { mode: 0 };\n' +
      'function reset() { cfg.mode = "off"; }\n' +
      'if (cfg.mode) reset();\n' +
      'if (cfg.mode == 0) print("maybe", "\\n");\n', 3, 9);
    expect(text).toContain('integer');
    expect(text).toContain('string');
  });
});

describe('broken-comment regex cascade', () => {
  test('a lone `/` gets ONE root-cause hint, not a mountain', async () => {
    const ds = await diags(
      'let a = 1;\n' +
      '/print(a, "x");   // a comment missing its second slash\n' +
      'print(a, "\\n");\n');
    const hints = ds.filter(d => /If a comment was intended/.test(d.message));
    expect(hints.length).toBe(1);
  });

  test('the broken line contributes NOTHING but the hint (no NaN/semantic noise)', async () => {
    // The "closing" slash donated by the trailing `//` comment used to close the
    // regex, whose division against the prose produced UC2008 "always NaN" etc.
    // At statement position a comment-closer means the whole line is a broken
    // comment: consumed as one, exactly one diagnostic.
    const ds = await diags(
      'let a = 1;\n' +
      '/print(a, "x");   // uncomment to run\n' +
      'print(a, "\\n");\n');
    const onBrokenLine = ds.filter(d => d.range.start.line === 1);
    expect(onBrokenLine.length).toBe(1);
    expect(onBrokenLine[0].message).toContain('If a comment was intended');
    expect(ds.some(d => d.code === 'UC2008')).toBe(false);
  });

  test('diagnostics on OTHER lines survive the broken line', async () => {
    const ds = await diags(
      'function f1(c) {\n' +
      '    let v;\n' +
      '    if (c) v = { a: 1 };\n' +
      '    return v.a;\n' +
      '}\n' +
      '/print(f1(0), "x");   // broken comment\n' +
      'print(f1(1), "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);
  });
});

describe('I-2: currentType reads are position-aware', () => {
  test('a read BEFORE the write is not typed by the later write (UC5003 FP)', async () => {
    // Runtime: f(0, {foo: 7}) returns 7 - x.foo precedes the array write.
    const ds = await diags(
      'function f(c, x) {\n' +
      '    let y = x.foo;\n' +
      '    if (c) x = [1];\n' +
      '    return y;\n' +
      '}\n' +
      'print(f(0, { foo: 7 }), "\\n");\n');
    expect(ds.some(d => d.code === 'UC5003')).toBe(false);
  });
});

describe('H-1: implicit-null returns join the return union', () => {
  test('fall-off-the-end adds | null: deref of the call result warns', async () => {
    // Runtime: f(0) returns null; f(0).a crashes. Was silent.
    const ds = await diags(
      'function f(c) {\n' +
      '    if (c) return { a: 1 };\n' +
      '}\n' +
      'print(f(1).a, "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006' || d.code === 'UC5005')).toBe(true);
  });

  test('result variable hovers as union with null', async () => {
    const text = await hover(
      'function f(c) {\n' +
      '    if (c) return 1;\n' +
      '}\n' +
      'let r = f(0);\n' +
      'print(r, "\\n");\n', 3, 4);
    expect(text).toContain('integer');
    expect(text).toContain('null');
  });

  test('a function whose every path returns keeps its exact type', async () => {
    const text = await hover(
      'function f(c) {\n' +
      '    if (c) return 1;\n' +
      '    return 2;\n' +
      '}\n' +
      'let r = f(0);\n' +
      'print(r, "\\n");\n', 4, 4);
    expect(text).toContain('integer');
    expect(text).not.toContain('null');
  });
});

describe('one-liners: builtin return and guard soundness', () => {
  test('pop()/shift() results carry | null', async () => {
    const text = await hover(
      'let q = ["a", "b"];\n' +
      'let item = shift(q);\n' +
      'print(item, "\\n");\n', 2, 7);
    expect(text).toContain('string');
    expect(text).toContain('null');
  });

  test('split() on a string|unknown arg keeps | null on the result', async () => {
    const text = await hover(
      'function f(c, p) {\n' +
      '    if (c) p = "a,b";\n' +
      '    let parts = split(p, ",");\n' +
      '    return parts;\n' +
      '}\n' +
      'print(f(1, "x,y"), "\\n");\n', 3, 12);
    expect(text).toContain('null');
  });

  test('match() no longer narrows its subject to string', async () => {
    // match([1,2], /1/) is ["1"] - the subject is COERCED, a truthy match does
    // not prove string. push(x, 1) on the array path must not be argument-flagged.
    const ds = await diags(
      'function f(x) {\n' +
      '    if (match(x, /1/)) {\n' +
      '        push(x, 9);\n' +
      '        return x;\n' +
      '    }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f([1, 2]), "\\n");\n');
    expect(ds.some(d => d.code === 'UC2004')).toBe(false);
  });

  test('genuine string-contract narrowing still works (split, non-coercing)', async () => {
    // split() returns null for ANY non-string subject without coercing, so a
    // truthy result DOES prove string - unlike match(), which coerces.
    const text = await hover(
      'function f(p) {\n' +
      '    if (split(p, ",")) { return p; }\n' +
      '    return null;\n' +
      '}\n' +
      'print(f("a,b"), "\\n");\n', 1, 32);
    expect(text).toContain('string');
  });
});
