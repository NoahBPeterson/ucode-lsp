// A function installed on the builtin `global` object (`global.X = function…`) is a real
// global binding, callable bare as `X(...)` — in strict AND non-strict mode (verified vs
// the interpreter). The "Undefined function" check previously ignored these (only the
// variable check honored them via isGlobalProperty); now both do, via a pre-pass shared
// with the type checker.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const undefMsgs = async (code) => (await server.getDiagnostics(code, `/tmp/gpf-${n++}.uc`) || [])
  .filter((x) => x.severity === 1)
  .map((x) => x.message)
  .filter((m) => /Undefined (function|variable)|UC1001/.test(m));

// ── The fix: bare call of a global-property function ─────────────────────────
test('01 global.X = fn; X() is not "Undefined function"', async () => {
  expect(await undefMsgs('global.handle = function(e) { return e; };\nhandle({});\n')).toEqual([]);
});
test('02 works under \'use strict\' (not strict-gated — global.X is legal in strict)', async () => {
  expect(await undefMsgs("'use strict';\nglobal.handle = function(e) { return e; };\nif (1) { handle({}); }\n")).toEqual([]);
});
test('03 arrow value: global.X = () => …; X() is clean', async () => {
  expect(await undefMsgs('global.go = (x) => x * 2;\ngo(21);\n')).toEqual([]);
});
test('04 computed form global["X"] = fn; X() is clean', async () => {
  expect(await undefMsgs('global["foo"] = function() { return 1; };\nfoo();\n')).toEqual([]);
});

// ── Ordering robustness (pre-pass, not traversal-order dependent) ─────────────
test('05 call appearing before the global.X assignment is still suppressed', async () => {
  expect(await undefMsgs('function run() { return handle(); }\nglobal.handle = function() { return 1; };\n')).toEqual([]);
});
test('06 call nested in a block / branch (the metrics.uc shape) is clean', async () => {
  const code = "'use strict';\nglobal.handle_request = function(env) { return env; };\nif (!(\"x\" in global)) { handle_request({}); }\n";
  expect((await undefMsgs(code)).some((m) => /handle_request/.test(m))).toBe(false);
});

// ── Variable (non-call) reads still fine (regression on isGlobalProperty) ─────
test('07 global.X = value; reading X as a variable is not "Undefined variable"', async () => {
  expect(await undefMsgs('global.myval = 7;\nlet z = myval + 1;\n')).toEqual([]);
});
test('08 global.X = fn; referencing X without calling is clean', async () => {
  expect(await undefMsgs('global.cb = function() { return 1; };\nlet ref = cb;\n')).toEqual([]);
});

// ── Multiple / mixed ─────────────────────────────────────────────────────────
test('09 multiple global functions all resolve', async () => {
  const code = 'global.a = function() { return 1; };\nglobal.b = function() { return 2; };\na();\nb();\n';
  expect(await undefMsgs(code)).toEqual([]);
});
test('10 global.X assigned inside a function, called elsewhere, is clean', async () => {
  const code = 'function install() { global.handler = function() { return 1; }; }\nfunction use() { return handler(); }\n';
  expect(await undefMsgs(code)).toEqual([]);
});

// ── Soundness: only `global.` counts ─────────────────────────────────────────
test('11 a non-global object property does NOT suppress a bare call', async () => {
  // `o.handle = fn` is not a global binding — bare `handle()` is still undefined
  const code = 'let o = {};\no.handle = function() { return 1; };\nhandle();\n';
  expect((await undefMsgs(code)).some((m) => /Undefined function: handle/.test(m))).toBe(true);
});
test('12 a genuinely undefined function is still flagged', async () => {
  expect((await undefMsgs('totallyMissing();\n')).some((m) => /Undefined function: totallyMissing/.test(m))).toBe(true);
});

// ── Hover on a global-property name (synthesized from global.propertyTypes) ───
async function hoverAt(code, marker, idInMarker) {
  const mi = code.lastIndexOf(marker);
  const i = mi + marker.indexOf(idInMarker);
  const pre = code.slice(0, i);
  const line = (pre.match(/\n/g) || []).length;
  const col = i - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/gpf-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || ''));
}
test('13 hover on a bare-called global function shows it is a function', async () => {
  const t = await hoverAt('global.handle = function(e) { return e; };\nhandle({});\n', 'handle({', 'handle');
  expect(t).toContain('function');
  expect(t).toContain('handle');
});
test('14 hover on a global-function reference (not a call) resolves too', async () => {
  const t = await hoverAt('global.cb = function() { return 1; };\nlet r = cb;\n', 'r = cb', 'cb');
  expect(t).toContain('function');
});
test('15 hover on a global VALUE property shows its value type', async () => {
  const t = await hoverAt('global.myval = 7;\nlet z = myval;\n', 'z = myval', 'myval');
  expect(t).toContain('integer');
});
test('16 a normal local variable still hovers normally (regression)', async () => {
  const t = await hoverAt('let local = "x";\nlet z = local;\n', 'z = local', 'local');
  expect(t).toContain('string');
});
