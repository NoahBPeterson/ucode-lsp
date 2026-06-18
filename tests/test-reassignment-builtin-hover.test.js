// Regression: hover on a variable must always show its type, and a builtin
// call's per-call narrowed return type must survive on REASSIGNMENT (and
// redeclaration), exactly as it does on declaration. (Issue 2)
//
// Two invariants enforced here:
//   1. Hover on a declared variable is NEVER empty — "no hover on a variable" is a bug.
//   2. The narrowed builtin return type (e.g. max() -> null, uniq([1]) -> array<integer>)
//      is identical whether the variable is declared, redeclared, or reassigned.
//
// History: `a = max()` used to hover as `integer` (the builtin's STATIC return type)
// because the reassignment handler preferred inferFunctionCallReturnType over the
// narrowed checkNode result. The declaration path was always correct; this asserts parity.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, getHover;
let n = 0;
const fp = () => `/tmp/reassign-hover-${n++}.uc`;
const text = (h) => (!h || !h.contents) ? '' : (typeof h.contents === 'string' ? h.contents : (h.contents.value || ''));

// hover exactly on the FIRST `a` token at the start of the given 0-based line
async function hoverA(code, line, col) {
  return getHover(code, fp(), line, col);
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getHover = server.getHover;
});
afterAll(() => { try { server.shutdown(); } catch {} });

// expr -> expected type fragments that must ALL appear in the hover text
const CASES = [
  ['min()',         ['null']],            // zero-arg -> narrowed null
  ['max()',         ['null']],            // zero-arg -> narrowed null
  ['chr()',         ['string']],          // zero-arg -> empty string
  ['ord()',         ['null']],            // zero-arg -> deterministically null (not integer|null)
  ['type()',        ['null']],            // zero-arg -> deterministically null (not string|null)
  ['uchr()',        ['string']],
  ['min(3, 1, 2)',  ['integer']],         // with args -> static integer
  ['chr(65)',       ['string']],
  ['uniq([1, 2])',  ['array<integer>']],  // narrowed element type
];

describe('builtin return type survives reassignment/redeclaration in hover', () => {
  for (const [expr, expected] of CASES) {
    test(`reassign: a = ${expr}`, async () => {
      const code = `let a = 1;\na = ${expr};\n`;
      const h = await hoverA(code, 1, 0); // `a` at column 0 on the reassignment line
      const t = text(h);
      expect(t).not.toBe(''); // invariant 1: a variable must always have a hover
      for (const frag of expected) expect(t).toContain(frag);
    });

    test(`declare: let a = ${expr}`, async () => {
      const code = `let a = ${expr};\n`;
      const h = await hoverA(code, 0, 4); // `a` at column 4 after `let `
      const t = text(h);
      expect(t).not.toBe('');
      for (const frag of expected) expect(t).toContain(frag);
    });

    test(`redeclare: let a = []; let a = ${expr}`, async () => {
      const code = `let a = [1, 2, 3];\nlet a = ${expr};\n`;
      const h = await hoverA(code, 1, 4); // `a` of the SECOND `let a` (column 4)
      const t = text(h);
      expect(t).not.toBe(''); // the specific regression the user hit: redeclaration showed no hover
      for (const frag of expected) expect(t).toContain(frag);
    });
  }

  // Zero-arg ord()/type() are DETERMINISTICALLY null; with a (possibly-null) arg the
  // return widens to the general signature union. The narrowing must distinguish them.
  test('ord/type: zero-arg is null, with-arg is the union', async () => {
    expect(text(await hoverA('let a = type();\n', 0, 4))).toContain('null');
    expect(text(await hoverA('let a = type();\n', 0, 4))).not.toContain('string');
    expect(text(await hoverA('let a = ord();\n', 0, 4))).toContain('null');
    expect(text(await hoverA('let a = ord();\n', 0, 4))).not.toContain('integer');
    // with a possibly-null argument, type() can still return a string -> union preserved
    const withArg = text(await hoverA('let x = foo();\nlet a = type(x);\n', 1, 4));
    expect(withArg).toContain('string');
    expect(withArg).toContain('null');
  });

  // ord() return type is sound w.r.t. ucode's null-on-out-of-bounds semantics:
  // null when the string is empty (str[0] OOB) or a position argument is out of range.
  // Plain `integer` is only sound for a provably in-bounds access.
  test('ord(): integer only when provably in bounds, else integer | null', async () => {
    const t = async (decl, expr, line) => text(await hoverA(`${decl}let a = ${expr};\n`, line, 4));
    // provably in bounds: single non-empty string literal, no position arg
    const lit = await t('', 'ord("A")', 0);
    expect(lit).toContain('integer');
    expect(lit).not.toContain('null');
    // empty literal -> str[0] is out of bounds -> null possible
    const empty = await t('', 'ord("")', 0);
    expect(empty).toContain('integer');
    expect(empty).toContain('null');
    // string variable could be "" -> null possible
    const v = await t('let s = "x";\n', 'ord(s)', 1);
    expect(v).toContain('integer');
    expect(v).toContain('null');
    // position argument -> can be out of bounds -> null possible
    const pos = await t('', 'ord("A", 0)', 0);
    expect(pos).toContain('integer');
    expect(pos).toContain('null');
    // non-string argument -> always null
    expect(await t('', 'ord(5)', 0)).toContain('null');
  });

  // splice() with no args returns null deterministically (assert_mutable_array fails on the
  // missing array arg); with an array arg it returns that array (element type preserved).
  test('splice(): zero-arg is null, with-array preserves the array type', async () => {
    const zero = text(await getHover('let b = splice();\n', fp(), 0, 4));
    expect(zero).not.toBe('');
    expect(zero).toContain('null');
    expect(zero).not.toContain('array');
    const withArr = text(await getHover('let a = [1, 2, 3];\nlet b = splice(a);\n', fp(), 1, 4));
    expect(withArr).toContain('array<integer>');
  });

  // Declaration and reassignment must agree exactly — no path-dependent divergence.
  test('declaration and reassignment types are identical for every case', async () => {
    for (const [expr] of CASES) {
      const decl = text(await hoverA(`let a = ${expr};\n`, 0, 4));
      const reassign = text(await hoverA(`let a = 1;\na = ${expr};\n`, 1, 0));
      const typeLine = (s) => (s.match(/\(variable\)[^\n]*|`[^`]+`/) || [''])[0];
      expect(typeLine(reassign)).toBe(typeLine(decl));
    }
  });
});
