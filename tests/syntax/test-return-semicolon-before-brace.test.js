// `return <expr>` with no `;` immediately before `}` (or EOF) is valid ucode (verified vs
// the interpreter, strict and non-strict) — so it must NOT raise UC6004 "Expected ';'
// after return value". But `return <expr>` followed by another statement is a real syntax
// error (two statements, no separator) and must STILL be flagged.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/rsb-${n++}.uc`) || []);
const hasReturnSemi = (ds) => ds.some((d) => /after return value/.test(d.message));
const hasBareReturnError = (ds) => ds.some((d) => /Expected an expression after 'return'/.test(d.message));

// ── No false positive: missing `;` before `}` / EOF ──────────────────────────
test('01 `return expr` with no `;` before `}` is clean', async () => {
  expect(hasReturnSemi(await diags('function f(dms) {\n  return split(dms, "/")[-1]\n}\n'))).toBe(false);
});
test('02 `return expr` as the last line (EOF) is clean', async () => {
  expect(hasReturnSemi(await diags('function f() {\n  return 1\n}\nf()\n'))).toBe(false);
});
// A value-LESS `return` immediately before `}` (or at EOF) is a genuine ucode syntax error:
// `uc_compiler_compile_return` -> `uc_compiler_compile_expstmt` only treats a leading `;` as
// an empty return, so `return }` compiles as "Expecting expression" (verified vs the vendored
// ucode/ucode binary: `function f(){ return }` and `if (x) return\n}` both exit 255). Ticket 153.
test('03 bare `return` before `}` (no value, no `;`) IS flagged (ucode rejects it)', async () => {
  const ds = await diags('function f(x) {\n  if (x) return\n}\n');
  expect(hasBareReturnError(ds)).toBe(true);
  // …but it is NOT the "after return value" diagnostic (that's the different, value-present case).
  expect(hasReturnSemi(ds)).toBe(false);
});
test('03b value-less `return` at EOF IS flagged', async () => {
  expect(hasBareReturnError(await diags('function f() {\n  return\n'))).toBe(true);
});
test('03c `return;` (empty return, explicit `;`) is clean', async () => {
  const ds = await diags('function f() {\n  return;\n}\nf();\n');
  expect(hasBareReturnError(ds)).toBe(false);
  expect(hasReturnSemi(ds)).toBe(false);
});
test('04 nested: `return expr` before a closing `}` inside an if-block is clean', async () => {
  expect(hasReturnSemi(await diags('function f(x) {\n  if (x) {\n    return x * 2\n  }\n  return 0\n}\n'))).toBe(false);
});
test('05 `return expr;` WITH the semicolon is of course still clean', async () => {
  expect(hasReturnSemi(await diags('function f() {\n  return 42;\n}\n'))).toBe(false);
});

// ── Still a real error: `return expr` then another statement, no separator ────
test('06 `return 1` followed by another statement on the next line IS still flagged', async () => {
  // two statements with no separator — a genuine ucode syntax error
  expect(hasReturnSemi(await diags('function f() {\n  return 1\n  print("x");\n}\n'))).toBe(true);
});
