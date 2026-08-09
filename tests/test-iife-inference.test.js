// IIFE return-type inference (0.8.3): `const _parsed = (() => {…})()` — the
// module-constant initializer idiom (podman_socket.uc) — typed as `unknown` because
// call typing only resolved through NAMED callees. Now a function-literal callee's
// call takes the literal's own return union (analyzer stamp when visited, quiet
// own-returns walk otherwise), and the returned object literals' property shapes
// flow onto the binding exactly like a named factory's do.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function hoverAt(code, needle, delta = 1) {
  const p = `/tmp/iife-${n++}.uc`;
  await server.getDiagnostics(code, p);
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes(needle));
  const h = await server.getHover(code, p, line, lines[line].indexOf(needle) + delta);
  return h?.contents?.value ?? null;
}

const PARSED = [
  "const dest = 'unix:///x';",
  'const parsed = (() => {',
  "\tif (substr(dest, 0, 1) === '/')",
  "\t\treturn { scheme: 'unix', addr: dest };",
  '\treturn null;',
  '})();',
  'if (parsed) {',
  '\tlet raw = parsed.addr;',
  '\tprint(parsed.scheme, raw);',
  '}',
].join('\n');

test('arrow IIFE: union of returns, matching the named-function behavior', async () => {
  expect(await hoverAt(PARSED, 'parsed = (')).toContain('`object | null`');
});

test('the returned object shape flows onto the binding (member types + locals)', async () => {
  expect(await hoverAt(PARSED, 'raw = parsed.addr')).toContain('`string`');
  expect(await hoverAt(PARSED, 'scheme, raw', 3)).toContain('`string`');
});

test('truthiness guard narrows the IIFE binding', async () => {
  expect(await hoverAt(PARSED, 'parsed.addr', 2)).toContain('`object`');
});

test('function-expression IIFE with a single return stays un-widened', async () => {
  const code = [
    'const cfg = (function() {',
    "\treturn { mode: 'fast' };",
    '})();',
    'print(cfg.mode);',
  ].join('\n');
  const v = await hoverAt(code, 'cfg = (');
  expect(v).toContain('`object`');
  expect(v).not.toContain('null');
});

test('a body that can fall off the end contributes null', async () => {
  const code = [
    'const maybe = (() => {',
    '\tif (time() > 0)',
    '\t\treturn 1;',
    '})();',
    'print(maybe);',
  ].join('\n');
  expect(await hoverAt(code, 'maybe = (')).toContain('| null');
});

test("a nested function's returns are its own, not the IIFE's", async () => {
  const code = [
    'const box = (() => {',
    "\tlet helper = () => { return 'inner'; };",
    '\treturn { run: helper };',
    '})();',
    'print(box);',
  ].join('\n');
  const v = await hoverAt(code, 'box = (');
  expect(v).toContain('`object`');
  expect(v).not.toContain('string');
});

test('expression-body arrow IIFE types from its expression', async () => {
  const code = "const six = (() => 6)();\nprint(six);\n";
  expect(await hoverAt(code, 'six = (')).toContain('`integer`');
});

// UC7005 boolean-coercion quick fix: `return X && (…)` leaks X itself when falsy
// (ucode's && is value-preserving — compiler.c uc_compiler_compile_and), so an
// object|null guard types the return boolean|null. When X's non-null arms are
// always-truthy, `X != null && …` keeps the exact truth condition and returns a
// real boolean — offered as the PREFERRED fix, demoting the annotation-widening one.
test('UC7005 on `return guard && (…)` offers the != null coercion, preferred', async () => {
  const code = [
    "const _dest = 'unix:///x';",
    'const _parsed = (() => {',
    "\tif (substr(_dest, 0, 1) === '/')",
    "\t\treturn { scheme: 'unix', addr: _dest };",
    '\treturn null;',
    '})();',
    '/** @returns {boolean} true if destination is a TCP scheme */',
    'export function is_remote() {',
    "\treturn _parsed && (_parsed.scheme === 'tcp' || _parsed.scheme === 'tcp6');",
    '};',
    'print(is_remote());',
  ].join('\n');
  const p = `/tmp/iife-${n++}.uc`;
  const d = await server.getDiagnostics(code, p);
  const uc = (d || []).find((x) => String(x.code) === 'UC7005');
  expect(uc.message).toContain("'boolean|null'");
  const acts = await server.getCodeActions(p, [uc], uc.range.start.line, uc.range.start.character + 2);
  const coerce = (acts || []).find((a) => a.title === 'Return a real boolean (_parsed != null && …)');
  expect(coerce.isPreferred).toBe(true);
  const widen = (acts || []).find((a) => a.title.startsWith('Change @returns'));
  expect(widen.isPreferred).toBe(false); // demoted while the code-side fix is on offer
  expect(coerce.edit.changes[`file://${p}`][0].newText).toBe(' != null');
  // Applying it satisfies the annotation.
  const e = coerce.edit.changes[`file://${p}`][0];
  const applied = code.split('\n').map((l, i) => i === e.range.start.line
    ? l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.start.character) : l).join('\n');
  const d2 = await server.getDiagnostics(applied, `/tmp/iife-${n++}.uc`);
  expect((d2 || []).filter((x) => String(x.code) === 'UC7005')).toEqual([]);
});

test('no coercion fix when the guard has falsy non-null values (string)', async () => {
  const code = [
    'let name = ARGV[0];',
    '/** @returns {boolean} */',
    'export function has_name() {',
    '\treturn name && length(name) > 0;',
    '};',
    'print(has_name());',
  ].join('\n');
  const p = `/tmp/iife-${n++}.uc`;
  const d = await server.getDiagnostics(code, p);
  const uc = (d || []).find((x) => String(x.code) === 'UC7005');
  expect(uc).toBeTruthy();
  const acts = await server.getCodeActions(p, [uc], uc.range.start.line, uc.range.start.character + 2);
  // `"" != null` is true but `"" && …` is falsy — the rewrite would change behavior.
  expect((acts || []).some((a) => a.title.startsWith('Return a real boolean'))).toBe(false);
});
