// 50-distinct matrix for function-valued-variable return-type inference (0.6.193):
// `let f = () => {…}` / `let f = function(){…}` resolve f(...)'s type like a named fn.
// Covers block bodies, anonymous function expressions, expression bodies, union returns,
// builtin flow-through, narrowing, every binding form, and no-regression negatives.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// hover type at the last occurrence of `needle`
async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/fvm-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}
const errs = async (code) => (await server.getDiagnostics(code, `/tmp/fvm-${n++}.uc`) || []).filter((x) => x.severity === 1).map((x) => x.message);
// build: `let f = <expr>;\nlet r = f(<arg>);\nlet z = r;\n` and return the type of z
const callType = (fnExpr, arg = '1') => typeOf(`let f = ${fnExpr};\nlet r = f(${arg});\nlet z = r;\n`, 'z = r');

// ── A. Arrow, block body, single return — base types (1-8) ───────────────────
test('01 block: return string', async () => { expect(await callType('(p) => { return "x"; }')).toContain('string'); });
test('02 block: return integer', async () => { expect(await callType('(p) => { return 1; }')).toContain('integer'); });
test('03 block: return double', async () => { expect(await callType('(p) => { return 1.5; }')).toContain('double'); });
test('04 block: return boolean', async () => { expect(await callType('(p) => { return true; }')).toContain('boolean'); });
test('05 block: return null', async () => { expect(await callType('(p) => { return null; }')).toContain('null'); });
test('06 block: return array<integer>', async () => { expect(await callType('(p) => { return [1,2,3]; }')).toContain('array<integer>'); });
test('07 block: return object', async () => { expect(await callType('(p) => { return {a:1}; }')).toContain('object'); });
test('08 block: no return → null', async () => { expect(await callType('(p) => { print("x"); }')).toContain('null'); });

// ── B. Anonymous function expression — base types (9-14) ─────────────────────
test('09 fnexpr: return string', async () => { expect(await callType('function(p) { return "x"; }')).toContain('string'); });
test('10 fnexpr: return integer', async () => { expect(await callType('function(p) { return 7; }')).toContain('integer'); });
test('11 fnexpr: return boolean', async () => { expect(await callType('function(p) { return false; }')).toContain('boolean'); });
test('12 fnexpr: return array<integer>', async () => { expect(await callType('function(p) { return [1,2]; }')).toContain('array<integer>'); });
test('13 fnexpr: return object', async () => { expect(await callType('function(p) { return {x:1}; }')).toContain('object'); });
test('14 fnexpr: return null', async () => { expect(await callType('function(p) { return null; }')).toContain('null'); });

// ── C. Expression-body arrows (15-22) ────────────────────────────────────────
test('15 expr: string literal', async () => { expect(await callType('(x) => "x"')).toContain('string'); });
test('16 expr: integer literal', async () => { expect(await callType('(x) => 5')).toContain('integer'); });
test('17 expr: double literal', async () => { expect(await callType('(x) => 2.5')).toContain('double'); });
test('18 expr: boolean literal', async () => { expect(await callType('(x) => false')).toContain('boolean'); });
test('19 expr: array literal → array<integer>', async () => { expect(await callType('(x) => [9]')).toContain('array<integer>'); });
test('20 expr: object literal → object', async () => { expect(await callType('(x) => ({k:1})')).toContain('object'); });
test('21 expr: same-type ternary → string', async () => { expect(await callType('(p) => p ? "a" : "b"')).toContain('string'); });
test('22 expr: builtin call → array<string> | null', async () => { expect(await callType('(s) => split(s, ",")', '"a"')).toContain('array<string> | null'); });

// ── D. Union return types (23-28) ────────────────────────────────────────────
test('23 union: string | null', async () => { expect(await callType('(p) => { if (p) return "s"; return null; }')).toContain('string | null'); });
test('24 union: integer | null', async () => { expect(await callType('(p) => { if (p) return 1; return null; }')).toContain('integer | null'); });
test('25 union: boolean | null', async () => { expect(await callType('(p) => { if (p) return true; return null; }')).toContain('boolean | null'); });
test('26 union: double | null', async () => { expect(await callType('(p) => { if (p) return 1.5; return null; }')).toContain('double | null'); });
test('27 union: integer | string', async () => { expect(await callType('(p) => { if (p) return 1; return "s"; }')).toContain('integer | string'); });
test('28 union: array<integer> | null', async () => { expect(await callType('(p) => { if (p) return [1]; return null; }')).toContain('array<integer> | null'); });

// ── E. Binding forms / structure (29-36) ─────────────────────────────────────
test('29 const + function expression', async () => { expect(await typeOf('const f = function() { return "s"; };\nlet r = f();\nlet z = r;\n', 'z = r')).toContain('string'); });
test('30 const + arrow', async () => { expect(await typeOf('const f = () => 3;\nlet r = f();\nlet z = r;\n', 'z = r')).toContain('integer'); });
test('31 multiple params', async () => { expect(await typeOf('let f = (a, b, c) => { return "s"; };\nlet r = f(1,2,3);\nlet z = r;\n', 'z = r')).toContain('string'); });
test('32 rest param', async () => { expect(await typeOf('let f = (...xs) => { return 42; };\nlet r = f(1,2);\nlet z = r;\n', 'z = r')).toContain('integer'); });
test('33 nested arrow: outer return inferred', async () => { expect(await typeOf('let outer = () => { let inner = (y) => y; return "ok"; };\nlet r = outer();\nlet z = r;\n', 'z = r')).toContain('string'); });
test('34 multi-statement block before return', async () => { expect(await typeOf('let f = (p) => { let a = 1; let b = 2; return "s"; };\nlet r = f(1);\nlet z = r;\n', 'z = r')).toContain('string'); });
test('35 returns a locally-typed variable', async () => { expect(await typeOf('let f = () => { let s = "hi"; return s; };\nlet r = f();\nlet z = r;\n', 'z = r')).toContain('string'); });
test('36 no-parameter arrow', async () => { expect(await typeOf('let f = () => "x";\nlet r = f();\nlet z = r;\n', 'z = r')).toContain('string'); });

// ── F. Call-site / flow-through / narrowing (37-44) ──────────────────────────
test('37 result variable hovers as its return type (not unknown)', async () => {
  const t = await typeOf('let f = (p) => { if (p) return "x"; return null; };\nlet data = f(1);\nlet z = data;\n', 'z = data');
  expect(t).toContain('string | null');
});
test('38 the json(data) use-case type-checks after a null guard', async () => {
  const code = 'import * as fs from "fs";\n'
    + 'let read = (p) => { let fd = fs.open(p, "r"); if (fd) { return fd.read("all"); } return null; };\n'
    + 'let data = read("x");\nlet out = data != null ? json(data) : null;\n';
  expect((await errs(code)).some((m) => /json/.test(m) && /unknown|string or object/i.test(m))).toBe(false);
});
test('39 != null narrows the result inside the guard', async () => {
  const code = 'let f = (p) => { if (p) return "x"; return null; };\nlet data = f(1);\nif (data != null) { let z = data; }\n';
  expect(await typeOf(code, 'z = data')).toContain('string');
});
test('40 truthiness narrows the result inside the guard', async () => {
  const code = 'let f = (p) => { if (p) return "x"; return null; };\nlet data = f(1);\nif (data) { let z = data; }\n';
  expect(await typeOf(code, 'z = data')).toContain('string');
});
test('41 two distinct function variables keep independent return types', async () => {
  const code = 'let a = () => "s";\nlet b = () => 5;\nlet ra = a();\nlet rb = b();\nlet za = ra;\nlet zb = rb;\n';
  expect(await typeOf(code, 'za = ra')).toContain('string');
  expect(await typeOf(code, 'zb = rb')).toContain('integer');
});
test('42 split-returning arrow result is array<string> | null at the call site', async () => {
  expect(await typeOf('let f = (s) => split(s, ",");\nlet r = f("a,b");\nlet z = r;\n', 'z = r')).toContain('array<string> | null');
});
test('43 a reassigned function variable keeps its declared return type (SSA discipline)', async () => {
  // declared signature holds at the declaration site
  expect(await typeOf('let f = () => "x";\nf = () => 5;\nlet r = f();\nlet z = r;\n', 'z = r')).toContain('string');
});
test('44 function value passed/aliased keeps a usable type (no crash)', async () => {
  const code = 'let f = () => "s";\nlet g = f;\nlet r = g();\nlet z = r;\n';
  // aliasing path already carried the signature; result should be string, never error
  expect((await errs(code)).length).toBe(0);
});

// ── G. No-regression / negatives (45-50) ─────────────────────────────────────
test('45 top-level named function still infers its return (regression)', async () => {
  expect(await typeOf('function k(p) { return "s"; }\nlet r = k(1);\nlet z = r;\n', 'z = r')).toContain('string');
});
test('46 untyped-param expression (x => x + 1) stays unknown (no over-claim)', async () => {
  expect(await callType('(x) => x + 1', '2')).toContain('unknown');
});
test('47 an ordinary integer variable is unaffected', async () => {
  expect(await typeOf('let n = 5;\nlet z = n;\n', 'z = n')).toContain('integer');
});
test('48 an ordinary object variable is unaffected', async () => {
  expect(await typeOf('let o = { a: 1 };\nlet z = o;\n', 'z = o')).toContain('object');
});
test('49 a bare map callback arrow produces no false diagnostics', async () => {
  expect((await errs('let xs = map([1,2,3], (v) => v * 2);\n')).length).toBe(0);
});
test('50 a bare filter callback arrow produces no false diagnostics (incl. length test-context)', async () => {
  expect((await errs("'use strict';\nfunction f(...values) { values = filter(values, (val) => length(val) > 0); return values; }\n"))
    .some((m) => /is unknown\. Use a type guard/.test(m))).toBe(false);
});
