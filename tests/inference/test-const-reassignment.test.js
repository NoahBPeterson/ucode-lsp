// auto-docs/16: reassigning a `const` was never flagged. ucode treats it as a hard error
// (verified vs /usr/local/bin/ucode):
//   const x=1; x=2;   → "Syntax error: Invalid assignment to constant 'x'"
//   const x=1; x+=2;  → same
//   const x=1; x++;   → "Syntax error: Invalid increment/decrement of constant 'x'"
// A validator existed (src/validations/const-reassignments.ts) but was dead code — the live
// AST SemanticAnalyzer never checked it. Fix: the analyzer now stamps `isConstant` on const
// bindings and flags UC1010 on any identifier-target assignment/increment. Mutating a const
// object's PROPERTY or array ELEMENT is legal in ucode, so member targets are NOT flagged.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/const-reassign-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri()) || []);
const errs = async (code) => (await diags(code)).filter((x) => x.severity === 1).map((x) => x.message);
const flagged = async (code) => (await errs(code)).some((m) => /constant/.test(m));

// ── Plain reassignment ───────────────────────────────────────────────────────
test('const x; x = 2 is flagged UC1010', async () => {
  expect(await flagged('const x = 1;\nx = 2;\n')).toBe(true);
});
test('the diagnostic uses code UC1010', async () => {
  const d = await diags('const x = 1;\nx = 2;\n');
  expect(d.some((x) => x.code === 'UC1010' || /UC1010/.test(JSON.stringify(x.code)))).toBe(true);
});
test('the message names the constant', async () => {
  expect((await errs('const total = 1;\ntotal = 2;\n')).some((m) => /constant 'total'/.test(m))).toBe(true);
});

// ── Every compound-assignment form ───────────────────────────────────────────
for (const op of ['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '&=', '^=', '|=', '&&=', '||=', '??=']) {
  test(`compound assignment const x; x ${op} 2 is flagged`, async () => {
    expect(await flagged(`const x = 1;\nx ${op} 2;\n`)).toBe(true);
  });
}

// ── Increment / decrement, prefix and postfix ────────────────────────────────
test('postfix x++ on a const is flagged (increment/decrement message)', async () => {
  expect((await errs('const x = 1;\nx++;\n')).some((m) => /increment\/decrement of constant 'x'/.test(m))).toBe(true);
});
test('postfix x-- on a const is flagged', async () => {
  expect(await flagged('const x = 1;\nx--;\n')).toBe(true);
});
test('prefix ++x on a const is flagged', async () => {
  expect(await flagged('const x = 1;\n++x;\n')).toBe(true);
});
test('prefix --x on a const is flagged', async () => {
  expect(await flagged('const x = 1;\n--x;\n')).toBe(true);
});

// ── Reassignment from a nested scope (the const lives in an enclosing scope) ──
test('reassigning a const from inside a nested function is flagged', async () => {
  expect(await flagged('const x = 1;\nfunction f() { x = 2; }\nf();\n')).toBe(true);
});
test('reassigning a const from inside a block is flagged', async () => {
  expect(await flagged('const x = 1;\nif (true) { x = 2; }\n')).toBe(true);
});

// ── NOT flagged: legal mutations ─────────────────────────────────────────────
test('mutating a const object PROPERTY is allowed (const o={}; o.x=5)', async () => {
  expect(await flagged('const o = {};\no.x = 5;\n')).toBe(false);
});
test('mutating a const object property via compound op is allowed', async () => {
  expect(await flagged('const o = { n: 0 };\no.n += 5;\n')).toBe(false);
});
test('mutating a const ARRAY element is allowed (const a=[1]; a[0]=9)', async () => {
  expect(await flagged('const a = [1];\na[0] = 9;\n')).toBe(false);
});
test('incrementing a const object property is allowed (o.n++)', async () => {
  expect(await flagged('const o = { n: 0 };\no.n++;\n')).toBe(false);
});

// ── NOT flagged: `let` is reassignable (regression) ──────────────────────────
test('reassigning a `let` is NOT flagged', async () => {
  expect(await flagged('let y = 1;\ny = 2;\n')).toBe(false);
});
test('incrementing a `let` is NOT flagged', async () => {
  expect(await flagged('let y = 1;\ny++;\n')).toBe(false);
});
test('a `let` shadowing nothing, only read, is clean', async () => {
  expect(await flagged('const x = 1;\nprint(x);\n')).toBe(false);
});

// ── A const declaration itself is not a reassignment ─────────────────────────
test('the const declaration line is not itself flagged', async () => {
  expect(await flagged('const x = 1;\nprint(x);\n')).toBe(false);
});
test('a `let` redeclared name shadowing a const in an inner scope is reassignable', async () => {
  // inner `let x` is a new binding; assigning it is fine
  expect(await flagged('const x = 1;\nfunction f() { let x = 9; x = 10; return x; }\nf();\n')).toBe(false);
});

// ── Multiple consts, only the offending one flagged ──────────────────────────
test('with two consts, only the reassigned one is flagged', async () => {
  const e = await errs('const a = 1;\nconst b = 2;\nb = 3;\n');
  expect(e.some((m) => /constant 'b'/.test(m))).toBe(true);
  expect(e.some((m) => /constant 'a'/.test(m))).toBe(false);
});
