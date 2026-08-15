// Member access on strings and arrays: what is DEFINITE vs merely POSSIBLE, and
// what a prototype changes. All expectations verified on owrt-main:
//
//   "abc".foo        -> THROWS  "left-hand side expression is not an array or object"
//   plainArray.foo   -> null, NO crash
//   proto(arr,{m}).m -> works; type() is still "array"; a[1] still indexes
//
// So a missing member on an array is a silent-null bug (the `st.ino` shape) and
// on a string is a real crash — and a prototype makes the access legitimate.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
let n = 0;
const fp = () => `/tmp/member-sev-${n++}.uc`;
const codes = async (code) => {
  const ds = await server.getDiagnostics(code, fp());
  return (ds || []).filter((d) => String(d.code) === 'UC5003')
    .map((d) => ({ sev: d.severity, msg: d.message }));
};

beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

describe('strings: definite vs possible', () => {
  test('a definite string hard-errors (it really throws)', async () => {
    const r = await codes('let s = "hi";\nprint(s.length, "\\n");');
    expect(r.length).toBe(1);
    expect(r[0].sev).toBe(1);
  });

  test('a union that also admits an object is a WARNING, not an error', async () => {
    // `v` is object-or-string here; the access is correct on one path, so this
    // is a may-fail. Reporting it red flagged correct code (openwrt unet.uc:829).
    const r = await codes([
      'function f(flag) {',
      '\tlet v;',
      '\ttry { v = "text"; v = json(ARGV[0]); } catch (e) { v = null; }',
      '\tif (!v) return null;',
      '\treturn v.hosts;',
      '}',
      'print(f(1), "\\n");',
    ].join('\n'));
    expect(r.length).toBe(1);
    expect(r[0].sev).toBe(2);
    expect(r[0].msg).toContain('may be a string');
  });
});

describe('arrays: the prototype chain is consulted', () => {
  test('a plain array member is still a hard error', async () => {
    const r = await codes('let a = [1,2];\nprint(a.mylen, "\\n");');
    expect(r.length).toBe(1);
    expect(r[0].sev).toBe(1);
  });

  test('a method supplied by proto() is accepted', async () => {
    const r = await codes([
      'let a = proto([3,1,2], {',
      '\tmylen: function() { return length(this); },',
      '});',
      'print(a.mylen(), "\\n");',
    ].join('\n'));
    expect(r).toEqual([]);
  });

  test('proto() applied in place, later, also counts', async () => {
    const r = await codes([
      'let a = [3,1,2];',
      'proto(a, { mylen: function() { return length(a); } });',
      'print(a.mylen(), "\\n");',
    ].join('\n'));
    expect(r).toEqual([]);
  });

  test('a member the prototype does NOT supply is still an error', async () => {
    const r = await codes([
      'let a = proto([1], { mylen: function() { return 1; } });',
      'print(a.nope, "\\n");',
    ].join('\n'));
    expect(r.length).toBe(1);
    expect(r[0].sev).toBe(1);
  });

  test('numeric indexing alongside prototype methods is never flagged', async () => {
    const r = await codes([
      'let a = proto([3,1,2], { first: function() { return this[0]; } });',
      'print(a[1], a.first(), "\\n");',
    ].join('\n'));
    expect(r).toEqual([]);
  });

  test('an array|null union from a call still hard-errors (soundness pin)', async () => {
    const r = await codes('let x = sort(keys({a:1}));\nx.foo;\n');
    expect(r.length).toBe(1);
    expect(r[0].sev).toBe(1);
  });
});
