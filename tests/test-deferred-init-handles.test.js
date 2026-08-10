// Deferred-init module handles (0.8.7, from the uspot/pbr FP triage):
//
// 1. UC5005 "provably null" on a module-level `let uacct;` whose real
//    assignment lives inside an init function, read via member access inside a
//    DIFFERENT function: the closure runs after init by lifecycle contract, so
//    the hard error downgrades to a may-null WARNING (mirror of the UC2010
//    isDeferredCallableFalsePositive). An explicit `x = null` before the read
//    keeps the hard error (soundness gate).
// 2. `x = require('mod')` in ASSIGNMENT position (not a declarator) now updates
//    SSA — require() throws on a missing module, never returns null, so the
//    old behavior (keeping the declared null seed) made
//    `let m4 = null; try { m4 = require('mwan4'); m4.load(); } catch {}`
//    "provably null" at the .load() (pbr platform.uc).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function diags(codeLines) {
  const code = codeLines.join('\n');
  return (await server.getDiagnostics(code, `/tmp/definit-${n++}.uc`)) || [];
}
const uc5005 = (ds) => ds.filter((d) => String(d.code) === 'UC5005');

test('uspot shape: init-assigned handle read in another function → warning, not error', async () => {
  const ds = await diags([
    'let uacct;',
    'function start(uspot) {',
    "\tuacct = uacct ? uacct : require('zzz_bpf_native');",
    '\tuacct.load(uspot);',
    '}',
    'function accounting(dev, mac) {',
    '\treturn uacct.client_get(dev, mac);',
    '}',
    'start("hotspot");',
    'print(accounting("br-lan", "aa:bb"));']);
  const hard = uc5005(ds).filter((d) => d.severity === 1);
  expect(hard).toEqual([]);
});

test('soundness: explicit `= null` before the read keeps the hard error', async () => {
  const ds = await diags([
    'let ctx;',
    'function f() {',
    '\tif (!ctx) return null;',
    '\tctx = null;',
    '\treturn ctx.foo;',
    '}',
    'function init(u) { ctx = u; }',
    'print(f());']);
  expect(uc5005(ds).length >= 1).toBe(true);
});

test('a handle with NO assignment anywhere stays a hard error', async () => {
  const ds = await diags([
    'let ctx;',
    'function f() { return ctx.foo; }',
    'print(f());']);
  expect(uc5005(ds).filter((d) => d.severity === 1).length).toBe(1);
});

test('pbr shape: `m4 = require(...)` assignment updates SSA — no provably-null', async () => {
  const ds = await diags([
    'let m4 = null;',
    'try {',
    "\tm4 = require('zzz_missing_mod');",
    '\tm4.load();',
    '} catch (e) {}',
    'if (m4)',
    '\tprint(m4.get_interfaces());']);
  expect(uc5005(ds)).toEqual([]);
});

test('require of a KNOWN module in assignment position types the module', async () => {
  const ds = await diags([
    'let handle = null;',
    "handle = require('fs');",
    'let st = handle.stat("/etc");',
    'print(st);']);
  expect(uc5005(ds)).toEqual([]);
  const uc5004 = ds.filter((d) => String(d.code) === 'UC5004');
  expect(uc5004).toEqual([]); // fs.stat resolves on the typed module record
});
