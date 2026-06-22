// Regression: an `if (!x) <early-exit>` guard must narrow a variable typed EXACTLY null
// (e.g. a module-level `let ctx;` whose only non-null assignment lives in another
// function) to non-null on the fall-through, so member access after the guard is not
// wrongly flagged UC5005. See docs/auto-docs/182-null-guard-not-narrowed-module-var.md.
// The narrowing is SOUND-GATED: an intervening reassignment to null still flags.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('null-guard early-return narrowing (UC5005)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const u5 = (ds) => ds.filter(d => d.code === 'UC5005').length;
  const diag = (code, name) => s.getDiagnostics(code, path.join('/tmp', name));

  it('module-level let guarded by `if (!ctx) return` is not flagged after the guard', async () => {
    const code = `let ctx;\nfunction f(n) {\n  if (!ctx) return null;\n  return ctx.get_all("network", n);\n}\nfunction init(uci) { ctx = uci; }\n`;
    assert.strictEqual(u5(await diag(code, 'ng-repro.uc')), 0, 'guarded module-var member access must not be UC5005');
  });

  it('multiple uses after the guard are all narrowed', async () => {
    const code = `let ctx;\nfunction f() {\n  if (!ctx) return null;\n  let a = ctx.foo;\n  let b = ctx.bar;\n  return a + b;\n}\nfunction init(u) { ctx = u; }\n`;
    assert.strictEqual(u5(await diag(code, 'ng-multi.uc')), 0, 'all post-guard uses narrowed');
  });

  it('SOUNDNESS: a reassignment to null AFTER the guard is still flagged', async () => {
    const code = `let ctx;\nfunction f() {\n  if (!ctx) return null;\n  ctx = null;\n  return ctx.foo;\n}\nfunction init(u) { ctx = u; }\n`;
    assert.ok(u5(await diag(code, 'ng-reassign.uc')) >= 1, 'stale guard after reassignment-to-null must still flag');
  });

  it('an unguarded provably-null member access is still flagged', async () => {
    assert.ok(u5(await diag(`let x = null;\nx.foo;\n`, 'ng-literal.uc')) >= 1, 'literal null member access flags');
    assert.ok(u5(await diag(`let ctx;\nfunction f() { return ctx.foo; }\n`, 'ng-unguarded.uc')) >= 1, 'unguarded module-null member access flags');
  });

  it('the positive block-guard form keeps working', async () => {
    const code = `let ctx;\nfunction f() {\n  if (ctx) { return ctx.foo; }\n  return null;\n}\nfunction init(u) { ctx = u; }\n`;
    assert.strictEqual(u5(await diag(code, 'ng-block.uc')), 0, 'positive block guard narrows too');
  });

  it('guard with throw / other early-exit also narrows', async () => {
    const code = `let ctx;\nfunction f() {\n  if (!ctx) die("no ctx");\n  return ctx.foo;\n}\nfunction init(u) { ctx = u; }\n`;
    assert.strictEqual(u5(await diag(code, 'ng-die.uc')), 0, 'early-exit via die() narrows');
  });
});
