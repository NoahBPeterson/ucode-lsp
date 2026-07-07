// Batch E type-inference regressions (verified against ucode C source):
//  - 115: exponent-notation number literals are DOUBLE even when integer-valued (parser
//    sets literalType 'double'); `1e5` → double, not integer.
//  - 116: division / modulo by a literal zero is DOUBLE (vm.c uc_vm_value_arith:
//    integer n2==0 → Infinity/NaN doubles). ucode does NOT raise.
//  - 120: `delete obj.k` evaluates to a boolean (vm.c uc_vm_insn_delete pushes a boolean).
//  - 111: filter predicate `e > 1` on `array<integer>` keeps element `integer`, not
//    the widened `integer | double`.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getHover;
let n = 0;
const fp = () => `/tmp/batchE-inf-${n++}.uc`;

function typeFrom(h) {
  const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  return t ? (t.replace(/\n/g, ' ').match(/`[^`]*`/)?.[0]?.replace(/`/g, '') || '?') : '(none)';
}
async function hoverType(expr) {
  const h = await getHover(`let x = ${expr};\n`, fp(), 0, 4);
  return typeFrom(h);
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getHover = server.getHover;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('115: exponent literals are double', () => {
  for (const [expr, expected] of [
    ['1e5', 'double'], ['2e3', 'double'], ['2.5e3', 'double'],
    ['1e308', 'double'], ['1.5e0', 'double'],
    ['5', 'integer'], ['5.5', 'double'], ['100', 'integer'],
  ]) {
    test(`${expr} → ${expected}`, async () => {
      expect(await hoverType(expr)).toBe(expected);
    });
  }
});

describe('116: divide/modulo by literal zero is double', () => {
  for (const [expr, expected] of [
    ['1/0', 'double'], ['0/0', 'double'], ['5%0', 'double'], ['1/0.0', 'double'],
    ['5/2', 'integer'], ['6/3', 'integer'], ['5%2', 'integer'],
  ]) {
    test(`${expr} → ${expected}`, async () => {
      expect(await hoverType(expr)).toBe(expected);
    });
  }
});

describe('120: delete expression is boolean', () => {
  test('delete obj.k → boolean', async () => {
    const code = 'let o = { a: 1 };\nlet r = delete o.a;\n';
    const h = await getHover(code, fp(), 1, 4);
    expect(typeFrom(h)).toBe('boolean');
  });
});

describe('111: filter predicate narrowing intersects with base element type', () => {
  test('filter(array<integer>, e => e > 1) stays array<integer>', async () => {
    const code = 'let a = [1, 2, 3];\nlet b = filter(a, (e) => e > 1);\n';
    const h = await getHover(code, fp(), 1, 4);
    expect(typeFrom(h)).toBe('array<integer>');
  });
});
