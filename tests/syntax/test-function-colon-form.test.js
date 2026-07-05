// ucode supports a colon-block form for functions — `function f(): … endfunction` — in
// addition to braces (verified vs the interpreter). Both the declaration and the expression
// forms are parsed, and their bodies analyzed like a braced body.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/fcf-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const has = async (code, code2) => (await diags(code)).some((d) => d.code === code2);
const syntaxErr = async (code) => (await diags(code)).some((d) => /UC6001|UC6002|UC6004|Expected/.test(d.code) || /Expected/.test(d.message));

// ── declaration colon-form ───────────────────────────────────────────────────
test('`function f(): … endfunction` parses with no syntax error', async () => {
  expect(await syntaxErr("function f():\n  return 1;\nendfunction\nprint(f());\n")).toBe(false);
});
test('the colon-form body is analyzed (undefined var → UC1001)', async () => {
  expect(await has("function f(x):\n  return undefined_var;\nendfunction\n", 'UC1001')).toBe(true);
});
test('params work in the colon-form', async () => {
  expect(await syntaxErr("function add(a, b):\n  return a + b;\nendfunction\nprint(add(1, 2));\n")).toBe(false);
});
test('a nested colon-block (if inside the function) parses', async () => {
  expect(await syntaxErr("function f(x):\n  if (x):\n    return 1;\n  endif;\n  return 0;\nendfunction\n")).toBe(false);
});

// ── expression colon-form ────────────────────────────────────────────────────
test('`let g = function(): … endfunction` parses and analyzes', async () => {
  const code = "let g = function():\n  return undefined_var2;\nendfunction;\nprint(g());\n";
  expect(await syntaxErr(code)).toBe(false);
  expect(await has(code, 'UC1001')).toBe(true); // body analyzed
});

// ── brace form untouched ─────────────────────────────────────────────────────
test('the brace form still parses', async () => {
  expect(await syntaxErr("function f() { return 1; }\nprint(f());\n")).toBe(false);
});

// ── missing both `{` and `:` → improved message ──────────────────────────────
test('a body with neither `{` nor `:` reports "Expected \'{\' or \':\'"', async () => {
  const ds = await diags("function f()\n  return 1;\n");
  expect(ds.some((d) => /Expected '\{' or ':'/.test(d.message))).toBe(true);
});

// ── other colon-block forms (verified vs the interpreter) ────────────────────
test('C-style `for (…; …; …): … endfor` parses (not just for-in)', async () => {
  expect(await syntaxErr("let s = 0;\nfor (let i = 1; i <= 3; i++):\n  s += i;\nendfor\nprint(s);\n")).toBe(false);
});
test('`while (…): … endwhile` parses', async () => {
  expect(await syntaxErr("let i = 0;\nwhile (i < 3):\n  i++;\nendwhile\n")).toBe(false);
});
test('`else` (no colon) in a colon-`if` chain is clean', async () => {
  expect(await syntaxErr("if (x):\n  print('a');\nelif (y):\n  print('b');\nelse\n  print('c');\nendif\n")).toBe(false);
});
test('`else:` (with a colon) is flagged — ucode rejects it', async () => {
  const ds = await diags("if (x):\n  print('a');\nelse:\n  print('b');\nendif\n");
  expect(ds.some((d) => /`else` takes no ':'/.test(d.message))).toBe(true);
});
