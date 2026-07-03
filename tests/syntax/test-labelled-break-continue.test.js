// labelled-break-continue-uc6010: parseBreakStatement/parseContinueStatement parsed
// an optional label — a pure JS-ism. ucode has no labels: uc_compiler_compile_control
// takes no operand, the statement must end at `;` ("Expecting ';'"), so `break d;`
// cannot compile. The label is still consumed for recovery (nothing downstream
// validates it), with UC6010 anchored on the label identifier.
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/labelled-jump-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const labelled = async (code) => (await diags(code)).filter((d) => d.code === 'UC6010');

const IN_LOOP = (stmt) => `let xs = [1, 2, 3];\nfor (let x in xs) {\n    ${stmt}\n}\n`;

// ── must flag (ucode: "Expecting ';'") ───────────────────────────────────────
test('break with a label is an error', async () => {
  const ds = await labelled(IN_LOOP('break outer;'));
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('does not support labels');
});
test('continue with a label is an error', async () => {
  const ds = await labelled(IN_LOOP('continue outer;'));
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain("after 'continue'");
});
test('diagnostic anchors on the label identifier', async () => {
  const ds = await labelled(IN_LOOP('break outer;'));
  expect(ds[0].range.start.line).toBe(2);
  expect(ds[0].range.start.character).toBe(10); // `    break outer;`
  expect(ds[0].range.end.character).toBe(15);
});

// ── must stay clean (valid ucode) ────────────────────────────────────────────
test('plain break stays clean', async () => {
  expect((await labelled(IN_LOOP('break;'))).length).toBe(0);
});
test('plain continue stays clean', async () => {
  expect((await labelled(IN_LOOP('continue;'))).length).toBe(0);
});
test('break inside a while stays clean', async () => {
  expect((await labelled('let i = 0;\nwhile (i < 3) {\n    i++;\n    break;\n}\n')).length).toBe(0);
});
test('break inside a switch case stays clean', async () => {
  const code = 'let v = 2;\nswitch (v) {\n    case 1:\n        print(v);\n        break;\n    default:\n        break;\n}\n';
  expect((await labelled(code)).length).toBe(0);
});

// ── recovery ─────────────────────────────────────────────────────────────────
test('exactly one error per labelled jump — no cascade into the rest of the loop', async () => {
  const code = 'let xs = [1, 2];\nfor (let x in xs) {\n    continue skip;\n    break skip;\n}\nlet z = undefined_thing;\n';
  const ds = await diags(code);
  expect(ds.filter((d) => d.code === 'UC6010').length).toBe(2);
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
  // the labels themselves must not produce undefined-variable noise
  expect(ds.some((d) => d.code === 'UC1001' && /skip/.test(d.message))).toBe(false);
});
