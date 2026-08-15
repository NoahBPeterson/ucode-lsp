// `@param {number}` / `@returns {number}` must mean `integer | double`.
//
// ucode has no `number` type — type(204) is "int", type(2.5) is "double". We
// mapped {number} → double ALONE, and a JSDoc annotation overrides inference,
// so a correctly-annotated status-code helper inferred `double` and
// `status_code === 204` became a HARD ERROR ("a value of type `double` can
// never be === 204"), making the 204 branch look dead. Real shape: LuCI's
// podman plugin (podman_http.uc:33 → podman.uc:73).
//
// Verified on owrt-main: type(+m[1]) is "int" and code === 204 is true;
// type(+"2.5") is "double". So {number} must admit both.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getHover, getDiagnostics;
let n = 0;
const fp = () => `/tmp/jsdoc-number-${n++}.uc`;

function typeFrom(h) {
  const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  return t ? (t.replace(/\n/g, ' ').match(/`[^`]*`/)?.[0]?.replace(/`/g, '') || '?') : '(none)';
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getHover = server.getHover;
  getDiagnostics = server.getDiagnostics;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('{number} resolves to integer | double', () => {
  test('a @returns {number} function hovers as integer | double', async () => {
    const code = [
      '/** @returns {number} */',
      'function f() { return 1; }',
      'let x = f();',
      '',
    ].join('\n');
    expect(typeFrom(await getHover(code, fp(), 2, 4))).toBe('integer | double');
  });

  test('a @param {number} parameter hovers as integer | double', async () => {
    const code = ['/** @param {number} n */', 'function g(n) { return n; }', ''].join('\n');
    expect(typeFrom(await getHover(code, fp(), 1, 11))).toBe('integer | double');
  });

  test('=== against an int literal is NOT reported impossible', async () => {
    const code = [
      '/** @returns {number} */',
      'function status() { return 204; }',
      'let code = status();',
      'if (code === 204) print("ok\\n");',
      '',
    ].join('\n');
    const ds = await getDiagnostics(code, fp());
    expect((ds || []).filter((d) => String(d.code) === 'UC2009')).toEqual([]);
  });

  test('=== against a double literal is also fine', async () => {
    const code = [
      '/** @returns {number} */',
      'function ratio() { return 1; }',
      'if (ratio() === 2.5) print("ok\\n");',
      '',
    ].join('\n');
    const ds = await getDiagnostics(code, fp());
    expect((ds || []).filter((d) => String(d.code) === 'UC2009')).toEqual([]);
  });

  test('the explicit ucode spellings still resolve to one type each', async () => {
    for (const [tag, expected] of [['int', 'integer'], ['integer', 'integer'], ['double', 'double'], ['float', 'double']]) {
      const code = [`/** @returns {${tag}} */`, 'function f() { return 1; }', 'let x = f();', ''].join('\n');
      expect(typeFrom(await getHover(code, fp(), 2, 4))).toBe(expected);
    }
  });

  test('a genuinely impossible comparison is STILL reported', async () => {
    const code = ['/** @returns {string} */', 'function s() { return "x"; }', 'if (s() === 204) print("no\\n");', ''].join('\n');
    const ds = await getDiagnostics(code, fp());
    expect((ds || []).some((d) => String(d.code) === 'UC2009')).toBe(true);
  });
});
