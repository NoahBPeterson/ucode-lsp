// Forward references to EXPORTED function declarations must resolve. `export function
// reload()` parses as an ExportNamedDeclaration wrapping a FunctionDeclaration, and
// hoistFunctionDeclarations previously only unwrapped bare declarations — so a
// function calling an exported function defined later in the same module (e.g. the
// real unetacl `config_set` → `reload`) was wrongly flagged "Undefined function".
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function undefinedFns(content, tag) {
  const d = await server.getDiagnostics(content, `/tmp/efr-${tag}.uc`);
  return (d || []).filter((x) => /Undefined function/.test(x.message || '')).map((x) => x.message);
}

test('forward ref to a later EXPORTED function does not error (the unetacl case)', async () => {
  const c = `export function config_set(obj, file) {\n    obj.config_file = file;\n    return reload(obj);\n}\nexport function reload(obj) {\n    return 0;\n}\n`;
  expect(await undefinedFns(c, 'export')).toEqual([]);
});

test('a plain function forward-refs a later exported function', async () => {
  const c = `function helper() { return reload(); }\nexport function reload() { return 0; }\n`;
  expect(await undefinedFns(c, 'mixed')).toEqual([]);
});

test('forward ref to a later `export default function` resolves', async () => {
  const c = `function caller() { return main(); }\nexport default function main() { return 1; }\n`;
  expect(await undefinedFns(c, 'default')).toEqual([]);
});

test('backward ref to an exported function still works', async () => {
  const c = `export function reload(obj) { return 0; }\nexport function config_set(obj) { return reload(obj); }\n`;
  expect(await undefinedFns(c, 'backward')).toEqual([]);
});

test('a genuinely undefined function is still flagged (no false negative)', async () => {
  const c = `export function f(obj) { return totallyMissing(obj); }\n`;
  const msgs = await undefinedFns(c, 'real');
  expect(msgs.length).toBe(1);
  expect(msgs[0]).toContain('totallyMissing');
});

test('mutual forward/backward recursion between exported functions', async () => {
  const c = `export function ping(n) { return n > 0 ? pong(n - 1) : 0; }\nexport function pong(n) { return n > 0 ? ping(n - 1) : 0; }\n`;
  expect(await undefinedFns(c, 'mutual')).toEqual([]);
});
