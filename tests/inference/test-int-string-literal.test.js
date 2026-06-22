// int() with a base-10 string LITERAL: the content is decidable, so (1) the return type narrows
// to the exact result and (2) any part of the string that int()'s numeric parse silently drops
// is flagged (UC2013), underlining exactly the ignored portion. All verified vs the ucode
// interpreter: int() consumes a leading decimal number (optional whitespace + sign + digits) and
// ignores the rest; with no leading digits it returns NaN (a double).

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getDiagnostics, getHover;
let n = 0;
const fp = () => `/tmp/intlit-${n++}.uc`;

async function uc2013(code) {
  const d = (await getDiagnostics(code, fp())) || [];
  return d.filter((x) => x.code === 'UC2013');
}
async function hoverType(expr) {
  const h = await getHover(`let x = ${expr};\n`, fp(), 0, 4);
  const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  return t ? (t.replace(/\n/g, ' ').match(/`[^`]*`/)?.[0]?.replace(/`/g, '') || '?') : '(none)';
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getHover = server.getHover;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('int() string-literal return narrowing', () => {
  for (const [expr, expected] of [
    ['int("42")', 'integer'], ['int("-7")', 'integer'], ['int("4.9")', 'integer'],
    ['int("10abc")', 'integer'], ['int("0x1f")', 'integer'], ['int("  10")', 'integer'],
    ['int("abc")', 'double'], ['int("")', 'double'], ['int("inf")', 'double'],
  ]) {
    test(`${expr} → ${expected}`, async () => {
      expect(await hoverType(expr)).toBe(expected);
    });
  }

  // literal base: decidable per base ("ff" valid in 16 → integer; "zz" invalid → double).
  // A NON-literal base can't be decided statically → stays integer | double.
  test('int(str, base): literal base narrows, non-literal base stays union', async () => {
    expect(await hoverType('int("ff", 16)')).toBe('integer');
    expect(await hoverType('int("zz", 16)')).toBe('double');
    expect(await hoverType('int("8", 8)')).toBe('double');
    const code = 'function f(b) { let a = int("ff", b); return a; }\n';
    const h = await getHover(code, fp(), 0, 20);
    const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
    expect((t || '').match(/`[^`]*`/)?.[0]).toBe('`integer | double`');
  });
});

describe('int() flags silently-dropped string content (UC2013)', () => {
  // partial parse: underline exactly the ignored trailing part
  for (const [code, ignored] of [
    ['int("10abc");\n', 'abc'],
    ['int("4.9");\n', '.9'],
    ['int("0x1f");\n', 'x1f'],   // forgot base 16
    ['int("5px");\n', 'px'],
    ['int("1 0");\n', ' 0'],
  ]) {
    test(`${code.trim()} underlines "${ignored}"`, async () => {
      const w = await uc2013(code);
      expect(w.length).toBe(1);
      expect(w[0].severity).toBe(2); // warning
      const r = w[0].range;
      expect(code.slice(r.start.character, r.end.character)).toBe(ignored);
    });
  }

  test('int("abc") (no leading number) warns on the whole string', async () => {
    const w = await uc2013('int("abc");\n');
    expect(w.length).toBe(1);
    expect(w[0].message).toContain('NaN');
  });

  // clean / harmless cases: no warning
  for (const code of ['int("42");\n', 'int("-7");\n', 'int("10  ");\n', 'int("  42");\n', 'int(x);\n', 'int("ff", 16);\n']) {
    test(`${code.trim()} → no UC2013`, async () => {
      expect((await uc2013(code)).length).toBe(0);
    });
  }
});
