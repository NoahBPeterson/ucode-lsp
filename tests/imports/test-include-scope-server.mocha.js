// SERVER-DRIVEN coverage for analysis/includeScope.ts (the lowest-covered file in
// coverage:e2e — its existing tests are direct-import and don't touch the bundle).
// This drives the include() render-scope machinery end-to-end through a real server
// rooted at a temp workspace: extractIncludeSites, resolveIncludePath,
// classifyScopeValue, buildIncludeScopeIndex (the cross-file fixpoint + injected
// TYPES), computeFreeVariables, and checkIncludeScopes (host-site "missing var").
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'incl-scope-'));
const W = (name, content) => fs.writeFileSync(path.join(ws, name), content);
const abs = (name) => path.join(ws, name);

// Includer using EVERY scope-value kind: bare ident (fw), literal (type), builtin
// ident (length), require() (fs module), object/array/function literals, a spread
// (dynamic), and a non-object scope arg (ident). Plus a bare include (no scope).
W('main.uc', `let fw = { rule: function() { return 1; } };
let dyn = { a: 1 };
include("child.uc", { fw, type: "filter", helper: length, mod: require("fs"), obj: {}, arr: [], fn: function(){} });
include("bare.uc");
include("spread.uc", { fw, ...dyn });
include("identscope.uc", dyn);
`);

// child.uc uses provided vars (must NOT be flagged) AND one var the scope omits
// (must be flagged at the include site in main.uc).
W('child.uc', `print(type);
fw.rule();
print(helper("x"));
mod.open("/tmp/x");
print(MISSING_VAR);
`);
W('bare.uc', `print("no scope here");\n`);
W('spread.uc', `fw.rule();\n`);
W('identscope.uc', `print(dyn);\n`);

// Transitive chain: parent -> mid (injects x) -> leaf (uses x, leaked transitively).
W('parent.uc', `let x = 5;\ninclude("mid.uc", { x });\n`);
W('mid.uc', `print(x);\ninclude("leaf.uc", { y: 1 });\n`);
W('leaf.uc', `print(x + y);\n`);

describe('includeScope render-scope coverage (server-driven)', function () {
  this.timeout(20000);
  let s;
  before(async () => { s = createLSPTestServer({ workspaceRoot: ws }); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  it('flags a template free var the include scope does not provide (checkIncludeScopes)', async () => {
    const ds = await s.getDiagnostics(fs.readFileSync(abs('main.uc'), 'utf8'), abs('main.uc'));
    const missing = ds.find(d => /MISSING_VAR/.test(d.message));
    assert.ok(missing, `expected a "scope does not provide MISSING_VAR" finding on main.uc, got: ${JSON.stringify(ds.map(d => d.message))}`);
  });

  it('does NOT flag scope-injected vars as undefined in the included file', async () => {
    const ds = await s.getDiagnostics(fs.readFileSync(abs('child.uc'), 'utf8'), abs('child.uc'));
    const undef = ds.filter(d => d.code === 'UC1001' || /Undefined variable/.test(d.message));
    const flaggedInjected = undef.filter(d => /\b(type|fw|helper|mod)\b/.test(d.message));
    assert.strictEqual(flaggedInjected.length, 0,
      `injected scope vars must not be flagged, got: ${JSON.stringify(undef.map(d => d.message))}`);
  });

  it('handles a bare include (no scope) and spread/ident (dynamic) scopes without crashing', async () => {
    const ds1 = await s.getDiagnostics(fs.readFileSync(abs('bare.uc'), 'utf8'), abs('bare.uc'));
    const ds2 = await s.getDiagnostics(fs.readFileSync(abs('spread.uc'), 'utf8'), abs('spread.uc'));
    assert.ok(Array.isArray(ds1) && Array.isArray(ds2));
  });

  it('transitive scope leak: leaf sees a var injected two levels up', async () => {
    // x is injected parent->mid and leaks mid->leaf even though mid's include omits it.
    const ds = await s.getDiagnostics(fs.readFileSync(abs('leaf.uc'), 'utf8'), abs('leaf.uc'));
    const undefX = ds.filter(d => /Undefined variable: x\b/.test(d.message));
    assert.strictEqual(undefX.length, 0, `transitively-leaked 'x' must not be flagged, got: ${JSON.stringify(ds.map(d => d.message))}`);
  });
});
