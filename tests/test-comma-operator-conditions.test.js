// auto-docs/06: the comma (sequence) operator was rejected inside `if`/`while`/`switch`
// conditions — the parser parsed a single assignment-expression then demanded ')'. It
// produced "Expected ')' after <X> condition" + "Unexpected token in expression", and a
// while-body's continue/break cascaded into false UC6001 ("outside loop") because the loop
// failed to parse. The comma operator already worked everywhere else (let-init, return,
// for-init/update, parenthesized exprs). Verified valid vs /usr/local/bin/ucode:
//   if (a=1, b=2) ...      while (a=next(), b=next()) ...      switch (a, b) ...
// Fix: parse those conditions at COMMA precedence (like for-init/update + parenthesized
// exprs). NOTE: ucode has no do-while loop (no `do` keyword), so that form is not covered.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/comma-cond-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);

// ── if-condition ─────────────────────────────────────────────────────────────
test('if (1, 2) parses cleanly', async () => {
  expect(await errs('if (1, 2) print("x");\n')).toEqual([]);
});
test('if (a = 1, b = 2) parses cleanly', async () => {
  expect(await errs('let a, b;\nif (a = 1, b = 2) print("x");\n')).toEqual([]);
});
test('if with a 3-way sequence parses cleanly', async () => {
  expect(await errs('let a, b, c;\nif (a = 1, b = 2, c = 3) print(c);\n')).toEqual([]);
});
test('no "Expected \')\' after if condition" for a comma condition', async () => {
  expect((await errs('if (1, 2) print("x");\n')).some((m) => /after if condition|Unexpected token/.test(m))).toBe(false);
});

// ── while-condition + the body cascade ───────────────────────────────────────
test('while (a, b) parses cleanly', async () => {
  expect(await errs('let a, b;\nwhile (a = 0, b = 0) break;\n')).toEqual([]);
});
test('the real-corpus while idiom is clean (no parse errors, no cascade)', async () => {
  const code = 'let names, values, f = 0;\n' +
    'while (names = f, values = f, f++ < 3) {\n' +
    '  if (names != values)\n    continue;\n' +
    '  break;\n' +
    '}\n';
  expect(await errs(code)).toEqual([]);
});
test('continue inside a comma-condition while is NOT a false UC6001', async () => {
  const code = 'let a, b;\nwhile (a = 1, b = 2) {\n  continue;\n}\n';
  expect((await errs(code)).some((m) => /outside loop|Continue statement/.test(m))).toBe(false);
});
test('break inside a comma-condition while is NOT a false UC6001', async () => {
  const code = 'let a, b;\nwhile (a = 1, b = 2) {\n  break;\n}\n';
  expect((await errs(code)).some((m) => /outside loop|Break statement/.test(m))).toBe(false);
});

// ── switch discriminant ──────────────────────────────────────────────────────
test('switch (a, b) parses cleanly', async () => {
  const code = 'let a, b;\nswitch (a = 1, b = 2) {\ncase 2:\n  print("y");\n  break;\n}\n';
  expect(await errs(code)).toEqual([]);
});

// ── Regressions: plain (non-comma) conditions still parse ─────────────────────
test('regression: plain if (cond) still parses', async () => {
  expect(await errs('if (1) print("x");\n')).toEqual([]);
});
test('regression: plain while (cond) still parses', async () => {
  expect(await errs('let i = 0;\nwhile (i < 3) i++;\n')).toEqual([]);
});
test('regression: plain switch (x) still parses', async () => {
  expect(await errs('let x = 1;\nswitch (x) {\ncase 1:\n  print("y");\n  break;\n}\n')).toEqual([]);
});
test('regression: a genuine continue OUTSIDE any loop is still flagged', async () => {
  expect((await errs('continue;\n')).some((m) => /outside loop|Continue/.test(m))).toBe(true);
});

// ── The sequence operator still works in the places it already did ───────────
test('regression: comma in let-init still parses (let x = (1, 2, 3))', async () => {
  expect(await errs('let x = (1, 2, 3);\nprint(x);\n')).toEqual([]);
});
test('regression: comma in for-init/update still parses', async () => {
  expect(await errs('for (let i = 0, j = 10; i < j; i++, j--) print(i);\n')).toEqual([]);
});
