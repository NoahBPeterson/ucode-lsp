// ucode does NOT hoist function values: a reference to a function declared later is
// a runtime error ("access to undeclared variable" — verified against the ucode
// interpreter), for plain AND exported functions. So the LSP flags forward references
// "used before its declaration"; backward references, recursion, and explicit
// `function f;` forward declarations are fine. (Imports are irrelevant — importing
// only one function still loads the whole module; the issue is purely declaration
// order within the module.)
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const msgs = async (content, tag) => (await server.getDiagnostics(content, `/tmp/efr-${tag}.uc`) || []).map((x) => x.message);
const usedBefore = (ms, name) => ms.filter((m) => m.includes(`Function '${name}' is used before its declaration`));
const undefinedFn = (ms, name) => ms.filter((m) => m.includes(`Undefined function: ${name}`));

test('forward ref to a later EXPORTED function is flagged (the unetacl config_set→reload bug)', async () => {
  const c = `export function config_set(obj, file) {\n    obj.config_file = file;\n    return reload(obj);\n}\nexport function reload(obj) {\n    return 0;\n}\n`;
  const m = await msgs(c, 'export-fwd');
  expect(usedBefore(m, 'reload').length).toBeGreaterThan(0);
});

test('forward ref to a later PLAIN function is flagged', async () => {
  const c = `function helper() { return later(); }\nfunction later() { return 0; }\n`;
  expect(usedBefore(await msgs(c, 'plain-fwd'), 'later').length).toBeGreaterThan(0);
});

test('backward ref to an exported function is clean', async () => {
  const c = `export function reload(obj) { return 0; }\nexport function config_set(obj) { return reload(obj); }\n`;
  expect(usedBefore(await msgs(c, 'export-bwd'), 'reload').length).toBe(0);
});

test('recursion is clean', async () => {
  const c = `export function fac(n) { return n <= 1 ? 1 : n * fac(n - 1); }\n`;
  expect(usedBefore(await msgs(c, 'rec'), 'fac').length).toBe(0);
});

test('an explicit `function f;` forward declaration makes a forward ref clean', async () => {
  const c = `function reload;\nexport function config_set(obj) { return reload(obj); }\nexport function reload(obj) { return 0; }\n`;
  expect(usedBefore(await msgs(c, 'fwd-decl'), 'reload').length).toBe(0);
});

test('mutual recursion: the forward half is flagged, the backward half is not', async () => {
  const c = `function isEven(n) { return n == 0 || isOdd(n - 1); }\nfunction isOdd(n) { return n != 0 && isEven(n - 1); }\n`;
  const m = await msgs(c, 'mutual');
  expect(usedBefore(m, 'isOdd').length).toBeGreaterThan(0);  // isEven→isOdd is forward
  expect(usedBefore(m, 'isEven').length).toBe(0);            // isOdd→isEven is backward
});

test('a genuinely undefined call is "Undefined function", not "used before declaration"', async () => {
  const c = `export function f(obj) { return totallyMissing(obj); }\n`;
  const m = await msgs(c, 'undef');
  expect(undefinedFn(m, 'totallyMissing').length).toBe(1);
  expect(usedBefore(m, 'totallyMissing').length).toBe(0);
});
