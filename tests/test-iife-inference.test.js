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
