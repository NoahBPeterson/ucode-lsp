// E2e tests for the largest end-to-end coverage gaps in typeChecker.ts and
// semanticAnalyzer.ts — features that were reachable but never exercised
// through the spawned LSP server (only unit tests, which the coverage tool
// cannot see, or nothing at all).
//
// Every expectation below was probed against the running server first, and the
// runtime facts were checked against the interpreter (owrt-main 2026-08-21):
//   type(/x/)   -> "regexp"   type(true) -> "bool"    type(1)    -> "int"
//   type(1.5)   -> "double"   type(print) -> "function"
//   type(null)  -> the NULL VALUE, not the string "null"
import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
let n = 0;
const fp = (t) => `/tmp/cov-${t}-${n++}.uc`;
const text = (h) => (!h || !h.contents) ? '' : (typeof h.contents === 'string' ? h.contents : (h.contents.value || ''));

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
});

// ── values(): the element type is the union of the source's property values ──
describe('values() element typing (typeChecker.valuesElementType)', () => {
  test('an object LITERAL yields the union of its value types', async () => {
    const code = 'let v = values({ a: 1, b: "x" });\nprint(v);\n';
    const h = await server.getHover(code, fp('values-lit'), 0, 4);
    expect(text(h)).toContain('array<integer | string>');
  });

  test('a bound identifier resolves through its propertyTypes', async () => {
    const code = 'let o = { a: 1, b: "x" };\nlet v = values(o);\nprint(v);\n';
    const h = await server.getHover(code, fp('values-var'), 1, 4);
    expect(text(h)).toContain('array<integer | string>');
  });

  test('a single-typed object collapses to one element type', async () => {
    const code = 'let v = values({ a: 1, b: 2 });\nprint(v);\n';
    expect(text(await server.getHover(code, fp('values-uni'), 0, 4))).toContain('array<integer>');
  });

  test('a SPREAD makes the value set unknowable — no bogus element type', async () => {
    const code = 'let base = { a: 1 };\nlet v = values({ ...base, b: "x" });\nprint(v);\n';
    const t = text(await server.getHover(code, fp('values-spread'), 1, 4));
    expect(t).not.toContain('array<integer | string>');
  });

  test('an empty object literal yields no element claim', async () => {
    const code = 'let v = values({});\nprint(v);\n';
    expect(text(await server.getHover(code, fp('values-empty'), 0, 4))).not.toContain('array<integer');
  });
});

// ── type() guard narrowing across every runtime spelling ──
describe('type() guard narrowing uses the runtime spellings', () => {
  const guard = (t) => `function f(x) {\n\tif (type(x) == "${t}") {\n\t\tlet y = x;\n\t\tprint(y);\n\t}\n}\nprint(f);\n`;
  const cases = [
    ['bool', 'boolean'],      // runtime says "bool", we narrow to boolean
    ['regexp', 'regexp'],     // runtime says "regexp", not "regex"
    ['function', 'function'],
    ['double', 'double'],
    ['array', 'array'],
    ['object', 'object'],
    ['string', 'string'],
    ['int', 'integer'],       // runtime says "int", we narrow to integer
  ];
  for (const [spelling, expected] of cases) {
    test(`type(x) == "${spelling}" narrows to ${expected}`, async () => {
      const h = await server.getHover(guard(spelling), fp('narrow-' + spelling), 2, 6);
      expect(text(h)).toContain(expected);
    });
  }

  test('a spelling type() NEVER returns is flagged as always-false (UC2009)', async () => {
    // type(null) yields the null VALUE, not the string "null" — verified live.
    for (const bogus of ['null', 'integer']) {
      const code = `function f(x) {\n\tif (type(x) == "${bogus}")\n\t\tprint("hit");\n}\nprint(f);\n`;
      const diags = await server.getDiagnostics(code, fp('uc2009-' + bogus));
      const hit = diags.filter(d => d.code === 'UC2009');
      expect(hit.length).toBe(1);
      expect(hit[0].message).toContain('always');
    }
  });
});

// ── loop-bound in-range proof, and the operations that invalidate it ──
describe('`arr[i]` inside `for (i = 0; i < length(arr); i++)`', () => {
  const loop = (body) => `let arr = [1, 2, 3];\nfor (let i = 0; i < length(arr); i++) {\n${body}\tlet e = arr[i];\n\tprint(e);\n}\n`;
  const elemLine = (body) => body.split('\n').length - 1 + 2;

  test('a plain loop proves the index in range — no spurious null', async () => {
    const code = loop('');
    const h = await server.getHover(code, fp('bound-ok'), 2, 5);
    expect(text(h)).toContain('integer');
    expect(text(h)).not.toContain('null');
  });

  test('push() only GROWS the array, so the proof survives', async () => {
    const code = loop('\tpush(arr, 9);\n');
    const h = await server.getHover(code, fp('bound-push'), 3, 5);
    expect(text(h)).not.toContain('null');
  });

  for (const shrinker of ['pop(arr);', 'shift(arr);', 'splice(arr, 0, 1);']) {
    test(`${shrinker.split('(')[0]}() SHRINKS it, so the element goes nullable`, async () => {
      const code = loop(`\t${shrinker}\n`);
      const h = await server.getHover(code, fp('bound-' + shrinker.split('(')[0]), 3, 5);
      expect(text(h)).toContain('null');
    });
  }

  test('reassigning the index variable invalidates the proof', async () => {
    const code = loop('\ti = 0;\n');
    expect(text(await server.getHover(code, fp('bound-reassign'), 3, 5))).toContain('null');
  });

  test('reassigning the ARRAY invalidates the proof', async () => {
    const code = loop('\tarr = [9];\n');
    expect(text(await server.getHover(code, fp('bound-arr'), 3, 5))).toContain('null');
  });
});
