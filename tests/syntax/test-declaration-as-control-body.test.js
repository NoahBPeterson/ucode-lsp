// declaration-as-control-body-uc6014: the parser accepted `let`/`const` in ANY
// statement position, including as the single-statement body of an if/else/while/for.
// But ucode declarations aren't statements — uc_compiler_compile_statement
// (compiler.c) has no TK_LOCAL/TK_CONST case, so `if (x) let y = …;` falls through to
// the expression parser and fails to compile with "Expecting expression" pointing at
// the keyword. Declarations are only legal at block/program level (via
// uc_compiler_compile_declaration). We keep parsing the declaration (scope/type
// recovery) but surface UC6014 anchored on the `let`/`const` keyword.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/decl-control-body-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const declBody = async (code) => (await diags(code)).filter((d) => d.code === 'UC6014');

// ── must flag (ucode: "Expecting expression") ────────────────────────────────
test('let as the body of an if is an error', async () => {
  const ds = await declBody('if (1)\n    let x = 5;\n');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain("'let' declaration cannot be the body");
  expect(ds[0].message).toContain("'if' statement");
});
test('const as the body of an if is an error', async () => {
  const ds = await declBody('if (1)\n    const x = 5;\n');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain("'const' declaration cannot be the body");
});
test('let as the body of an else clause is an error', async () => {
  const ds = await declBody('if (1)\n    print("a");\nelse\n    let x = 5;\n');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain("'else' clause");
});
test('let as the body of a while loop is an error', async () => {
  const ds = await declBody('while (0)\n    let x = 5;\n');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain("'while' loop");
});
test('let as the body of a C-style for loop is an error', async () => {
  const ds = await declBody('for (let i = 0; i < 1; i++)\n    let x = 5;\n');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain("'for' loop");
});
test('let as the body of a for-in loop is an error', async () => {
  const ds = await declBody('let a = [1, 2];\nfor (let i in a)\n    let x = 5;\n');
  expect(ds.length).toBe(1);
});
test('diagnostic anchors on the let keyword', async () => {
  const ds = await declBody('if (1)\n    let x = 5;\n');
  expect(ds[0].range.start.line).toBe(1);
  expect(ds[0].range.start.character).toBe(4);
  expect(ds[0].range.end.character).toBe(7);
});

// ── must stay clean (valid ucode) ────────────────────────────────────────────
test('let inside a braced if body stays clean', async () => {
  expect((await declBody('if (1) {\n    let x = 5;\n    print(x);\n}\n')).length).toBe(0);
});
test('let inside a braced while body stays clean', async () => {
  expect((await declBody('while (0) {\n    let x = 5;\n}\n')).length).toBe(0);
});
test('expression-statement body of an if stays clean', async () => {
  expect((await declBody('let x;\nif (1)\n    x = 5;\n')).length).toBe(0);
});
test('else if chain stays clean', async () => {
  expect((await declBody('if (1)\n    print("a");\nelse if (0)\n    print("b");\n')).length).toBe(0);
});
test('top-level let stays clean', async () => {
  expect((await declBody('let x = 5;\nlet y = 6;\n')).length).toBe(0);
});
test('function declaration as an if body stays clean (func IS a statement in ucode)', async () => {
  expect((await declBody('if (1)\n    function f() { return 1; }\n')).length).toBe(0);
});

// ── recovery ─────────────────────────────────────────────────────────────────
test('declared variable stays in scope after the error (no UC1001 cascade)', async () => {
  const ds = await diags('if (1)\n    let x = 5;\nprint(x);\n');
  expect(ds.some((d) => d.code === 'UC6014')).toBe(true);
});
test('analysis continues after the flagged declaration', async () => {
  const ds = await diags('if (1)\n    let x = 5;\nlet z = undefined_thing;\n');
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
});
