// An uninitialized `let` binding is `null` in ucode, definitively — verified vs
// /usr/local/bin/ucode: `let x; type(x) == "null"`. The LSP previously typed it `unknown`
// (a quiet imprecision). Now `visitVariableDeclarator` types a no-initializer identifier
// declarator as `null`; SSA flow still overrides it the moment the variable is assigned.
// Scoped to plain identifiers — function params (unknown), catch params (exception), and
// for-in loop vars (element type) are declared on other paths and are unaffected.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/uninit-null-${n++}.uc`;
async function hoverType(code, marker, id) {
  const i = code.lastIndexOf(marker) + marker.indexOf(id);
  const pre = code.slice(0, i);
  const line = (pre.match(/\n/g) || []).length;
  const col = i - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, uri(), line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return typeof v === 'string' ? v : JSON.stringify(v || '');
}
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);

// ── Core: uninitialized let is null ──────────────────────────────────────────
test('let x; types x as null', async () => {
  expect(await hoverType('let x;\nprint(x);\n', 'let x', 'x')).toMatch(/`null`|: null/);
});
test('let x; is identical to let x = null;', async () => {
  const a = await hoverType('let x;\nprint(x);\n', 'let x', 'x');
  const b = await hoverType('let x = null;\nprint(x);\n', 'let x', 'x');
  expect(a).toBe(b);
});
test('let x; does NOT type as unknown', async () => {
  expect(await hoverType('let x;\nprint(x);\n', 'let x', 'x')).not.toMatch(/unknown/);
});

// ── Multi-declarator: only the initialized one differs ───────────────────────
test('let a, b, f = 0, c; — a/b/c are null, f is integer', async () => {
  const code = 'let a, b, f = 0, c;\nprint(a, b, f, c);\n';
  expect(await hoverType(code, 'let a', 'a')).toMatch(/null/);
  expect(await hoverType(code, ', b,', 'b')).toMatch(/null/);
  expect(await hoverType(code, 'f = 0', 'f')).toMatch(/integer/);
  expect(await hoverType(code, ', c;', 'c')).toMatch(/null/);
});

// ── SSA flow still overrides null on assignment ──────────────────────────────
test('after `x = 5`, x is integer (flow override)', async () => {
  const code = 'let x;\nx = 5;\nprint(x);\n';
  expect(await hoverType(code, 'print(x', 'x')).toMatch(/integer/);
});
test('before its assignment x is null, after it is string', async () => {
  const code = 'let x;\nprint(x);\nx = "hi";\nprint(x);\n';
  expect(await hoverType(code, 'print(x);\nx', 'x')).toMatch(/null/);   // first print, before assign
  expect(await hoverType(code, 'print(x);\n', 'x')).toMatch(/string/);  // last print, after assign
});

// ── Regressions: other binding kinds are NOT nulled ──────────────────────────
test('a function parameter stays unknown (not null)', async () => {
  expect(await hoverType('function f(p) {\n  return p;\n}\n', 'return p', 'p')).toMatch(/unknown/);
});
test('a catch parameter stays exception (not null)', async () => {
  const t = await hoverType('try {\n  die("x");\n} catch (e) {\n  print(e);\n}\n', 'catch (e)', 'e');
  expect(t).toMatch(/exception/);
  expect(t).not.toMatch(/`null`/);
});
test('a for-in loop variable keeps its element type (not null)', async () => {
  expect(await hoverType('for (let k in [1, 2]) {\n  print(k);\n}\n', 'let k', 'k')).toMatch(/integer/);
});

// ── No new false positives from the null typing ──────────────────────────────
test('uninitialized then assigned then used in arithmetic is clean', async () => {
  expect(await errs('let x;\nx = 3;\nlet y = x + 1;\n')).toEqual([]);
});
test('bare uninitialized arithmetic (null + 1) is not flagged (null coerces in ucode)', async () => {
  // ucode: null + 1 == 1; not an error
  expect((await errs('let x;\nlet y = x + 1;\n')).some((m) => /NaN|arithmetic|null/.test(m))).toBe(false);
});
test('declared-only-then-read is clean (no "unused"/null noise beyond the existing unused warning)', async () => {
  expect(await errs('let x;\nprint(x);\n')).toEqual([]);
});

// ── const with an initializer is unaffected (it must have one in ucode) ───────
test('const C = 1; types as integer (const always has an initializer)', async () => {
  expect(await hoverType('const C = 1;\nprint(C);\n', 'const C', 'C')).toMatch(/integer/);
});
