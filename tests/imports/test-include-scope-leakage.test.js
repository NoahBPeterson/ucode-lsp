// `include("file.uc")` evaluates the target in a shared scope: ONLY the child's top-level
// implicit globals (bare `X = …` / `global.X = …`) leak into the includer's scope — `let`/
// `const`/`function` declarations stay child-locals (verified vs the interpreter; see
// docs/include-scope-resolution.md). So a reference to a leaked bare global must NOT be a
// false UC1001, while a reference to a child let/const/function stays undefined.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incscope-'));
  // Child: one bare global (leaks) + a let / a function / a const (all child-local, no leak).
  fs.writeFileSync(path.join(dir, 'child.uc'),
    'uvol_uci = {\n  add: function(x) { return x; },\n  remove: function(x) { return x; }\n};\n' +
    'let helper = function() { return 1; };\n' +
    'function fn_decl() { return 2; }\n' +
    'const C = 5;\n');
  // Child with an explicit global.X = … (also leaks).
  fs.writeFileSync(path.join(dir, 'gchild.uc'), 'global.gvar = 42;\n');
  // Grandchild chain for the transitive case.
  fs.writeFileSync(path.join(dir, 'grand.uc'), 'deep_global = 7;\n');
  fs.writeFileSync(path.join(dir, 'mid.uc'), 'include("grand.uc");\nmid_global = 1;\n');
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

async function diags(code) {
  const file = path.join(dir, `p-${Math.random().toString(36).slice(2)}.uc`);
  return (await server.getDiagnostics(code, file)) || [];
}
const undefNames = (ds) => ds.filter(d => d.code === 'UC1001').map(d => d.message);

test('bare implicit global from an included file is not UC1001', async () => {
  const ds = await diags('include("child.uc");\nlet a = uvol_uci.add;\nlet b = uvol_uci.remove;\nprint(a, b);\n');
  expect(undefNames(ds).some(m => m.includes('uvol_uci'))).toBe(false);
});

test('child let / const / function do NOT leak (still UC1001)', async () => {
  const ds = await diags('include("child.uc");\nlet a = helper;\nlet b = fn_decl;\nlet c = C;\nprint(a, b, c);\n');
  const msgs = undefNames(ds);
  expect(msgs.some(m => m.includes('helper'))).toBe(true);
  expect(msgs.some(m => m.includes('fn_decl'))).toBe(true);
  expect(msgs.some(m => m.includes('C'))).toBe(true);
});

test('explicit global.X in an included file leaks (no UC1001)', async () => {
  const ds = await diags('include("gchild.uc");\nprint(gvar);\n');
  expect(undefNames(ds).some(m => m.includes('gvar'))).toBe(false);
});

test('transitive include leaks a grandchild bare global', async () => {
  const ds = await diags('include("mid.uc");\nprint(mid_global, deep_global);\n');
  const msgs = undefNames(ds);
  expect(msgs.some(m => m.includes('mid_global'))).toBe(false);
  expect(msgs.some(m => m.includes('deep_global'))).toBe(false);
});

test('non-literal include path is skipped silently (no crash, no leak)', async () => {
  const ds = await diags('let p = "child.uc";\ninclude(p);\nprint(uvol_uci);\n');
  // uvol_uci is unresolved because the path is dynamic — must stay UC1001, and no crash.
  expect(undefNames(ds).some(m => m.includes('uvol_uci'))).toBe(true);
});

test('unresolvable include path is a no-op (no false diagnostics on the include itself)', async () => {
  const ds = await diags('include("/nonexistent/nowhere.uc");\nprint("ok");\n');
  expect(ds.filter(d => d.severity === 1).length).toBe(0);
});
