// Function-valued GLOBAL definitions get the same CodeLens (git history + references) as
// plain `function foo(){}` declarations: `global.X = function…` and top-level bare
// `X = function…` (implicit globals, the loadfile()() "export" idiom). Non-function globals
// and local `let f = function` get NO lens. Go-to-references also resolves for them.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });
const fp = () => `/tmp/gfc-${n++}.uc`;
async function refsLenses(code) {
  const f = fp();
  const lenses = (await server.getCodeLens(code, f)) || [];
  const out = [];
  for (const l of lenses) {
    if (l.data?.kind !== 'refs') continue;
    const r = await server.resolveCodeLens(l, f);
    out.push({ name: l.data.name, line: l.range.start.line, title: r?.command?.title });
  }
  return out;
}

test('global.X = function gets a refs lens on its line, counting calls', async () => {
  const info = await refsLenses('global.handle_request = function(env){ return env; };\nhandle_request({});\n');
  const hr = info.find(i => i.name === 'handle_request');
  expect(hr).toBeTruthy();
  expect(hr.line).toBe(0);
  expect(hr.title).toMatch(/1 reference/);
});
test('bare implicit-global function gets a lens', async () => {
  const info = await refsLenses('helper = function(){ return 1; };\nhelper(); helper();\n');
  expect(info.find(i => i.name === 'helper')?.title).toMatch(/2 references/);
});
test('plain function declaration still gets a lens (no regression)', async () => {
  const info = await refsLenses('function foo(){ return 1; }\nfoo();\n');
  expect(info.find(i => i.name === 'foo')?.title).toMatch(/1 reference/);
});
test('a non-function global (number) gets NO lens', async () => {
  const info = await refsLenses('global.MAX = 5;\nprint(MAX);\n');
  expect(info.find(i => i.name === 'MAX')).toBeUndefined();
});
test('a NESTED local `let f = function` still gets NO lens (only top-level/API surface)', async () => {
  const info = await refsLenses('function outer(){\n  let f = function(){ return 1; };\n  return f();\n}\n');
  expect(info.find(i => i.name === 'f')).toBeUndefined();
});
test('go-to-references resolves from a global.X definition', async () => {
  const code = 'global.handle_request = function(env){ return env; };\nhandle_request({});\nhandle_request({});\n';
  const refs = await server.getReferences(code, fp(), 0, 'global.handle_request'.indexOf('handle_request'));
  expect((refs || []).length).toBeGreaterThanOrEqual(2);
});

// ── (c) top-level let/const function vars + object-literal methods ────────────
test('top-level `let f = function` now gets a lens (+ references)', async () => {
  const info = await refsLenses('let f = function(){ return 1; };\nf();\nf();\n');
  const e = info.find(i => i.name === 'f');
  expect(e).toBeTruthy();
  expect(e.title).toMatch(/2 references/);
});
test('const arrow var gets a lens', async () => {
  const info = await refsLenses('const g = () => 1;\ng();\n');
  expect(info.find(i => i.name === 'g')?.title).toMatch(/1 reference/);
});
test('object-literal methods bound to a local count member references', async () => {
  const code = 'let api = {\n  check: function(a){ return a; },\n  run: function(){ return 1; },\n};\napi.check(1);\napi.check(2);\napi.run();\n';
  const info = await refsLenses(code);
  const check = info.find(i => i.name === 'check');
  const run = info.find(i => i.name === 'run');
  expect(check).toBeTruthy();
  expect(check.line).toBe(1);                 // lens on the method's line
  expect(check.title).toMatch(/2 references/); // api.check(1), api.check(2)
  expect(run.title).toMatch(/1 reference/);    // api.run()
});
test('rpc-handler `return { … }` methods get a lens (unbound → 0 in-file refs)', async () => {
  const code = "'use strict';\nreturn {\n  check_initialized: function(args, ctx){ return ctx; },\n  get_lang: function(args, ctx){ return args; },\n};\n";
  const info = await refsLenses(code);
  expect(info.find(i => i.name === 'check_initialized')).toBeTruthy();
  expect(info.find(i => i.name === 'get_lang')).toBeTruthy();
});
