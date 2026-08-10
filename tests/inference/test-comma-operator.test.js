// The comma/sequence operator yields its RIGHT operand.
//
// ucode/compiler.c registers TK_COMMA as a real infix rule
// (`[TK_COMMA] = { NULL, uc_compiler_compile_comma, P_COMMA }`), and the runtime
// confirms it: `x = (1, "str"); type(x)` → "string"; `(y = 5, 7)` → 7.
//
// The type checker had no case for it, so every comma expression inferred as
// `unknown` — and under 'use strict' an unknown-typed argument is an ERROR, so
// `length((a, "hello"))` was a red squiggle on correct code. The gap was
// invisible because BinaryExpressionNode's operator union didn't admit ','
// (a cast smuggled it past the type); banning `as` surfaced it.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getHover, getDiagnostics;
let n = 0;
const fp = () => `/tmp/comma-op-${n++}.uc`;

function typeFrom(h) {
  const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  return t ? (t.replace(/\n/g, ' ').match(/`[^`]*`/)?.[0]?.replace(/`/g, '') || '?') : '(none)';
}
async function hoverType(expr) {
  const h = await getHover(`let a = 1;\nlet x = ${expr};\n`, fp(), 1, 4);
  return typeFrom(h);
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getHover = server.getHover;
  getDiagnostics = server.getDiagnostics;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('comma operator yields the right operand', () => {
  for (const [expr, expected] of [
    ['(a, "hello")', 'string'],
    ['(a, 7)', 'integer'],
    ['(a, 2.5)', 'double'],
    ['(a, true)', 'boolean'],
    ['("x", "y", 3)', 'integer'],   // left-assoc chain: still the last operand
    ['(a, [1, 2])', 'array<integer>'],
    ['("discarded", null)', 'null'],
  ]) {
    test(`${expr} → ${expected}`, async () => {
      expect(await hoverType(expr)).toBe(expected);
    });
  }
});

describe('no false "unknown argument" error under strict', () => {
  test('length((a, "hello")) is clean', async () => {
    const code = `'use strict';\nlet a = 1;\nprint(length((a, "hello")), "\\n");\n`;
    const ds = await getDiagnostics(code, fp());
    expect(ds.filter((d) => d.severity === 1)).toEqual([]);
  });

  test('a genuinely wrong comma result IS still flagged', async () => {
    // The right operand is an integer — length() rejects it, comma or not.
    const code = `'use strict';\nlet a = 1;\nprint(length((a, 42)), "\\n");\n`;
    const ds = await getDiagnostics(code, fp());
    expect(ds.some((d) => d.severity === 1)).toBe(true);
  });
});

describe('a for-loop declaration list is NOT the comma operator', () => {
  test('for (let i = 0, j = 2; …) keeps both bindings typed', async () => {
    const code = 'for (let idx = 0, limit = 2; idx < limit; idx++)\n\tprint(idx, "\\n");\n';
    const h = await getHover(code, fp(), 0, 18); // the `limit` binding
    expect(typeFrom(h)).toBe('integer');
  });
});
