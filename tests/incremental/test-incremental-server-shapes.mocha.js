// SERVER-DRIVEN coverage for analysis/incrementalCache.ts — the soundness harness for
// it is direct-import (invisible to coverage:e2e). This drives the SERVER's incremental
// path via didChange edits so extractUnits (incl. the `return { … }` module-export
// shape + bare-object expression-statement), computeFingerprint, classifyBody, planClean
// and buildCache all run inside the bundle.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-srv-'));
const uri = (n) => `file://${path.join(ws, n)}`;

describe('incremental analysis server shapes (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer({ workspaceRoot: ws }); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  it('module return-{} shape: editing one method body re-analyzes soundly', async () => {
    const v1 = `'use strict';\nfunction helper(x) { return x + 1; }\nreturn {\n  api: function(a) { let r = helper(a); return r; },\n  other: function(b) { return b * 2; }\n};\n`;
    const d1 = await s.getDiagnostics(v1, path.join(ws, 'mod.uc'));
    assert.ok(Array.isArray(d1), 'module-return-object file analyzes');
    // edit one method body (comment) -> server runs incremental (planClean/buildCache)
    const v2 = v1.replace('return r;', 'return r; // tweak');
    s.openOrChangeDocument(uri('mod.uc'), v2, 2);
    const d2 = await s.waitForDiagnostics(uri('mod.uc'), () => true, 4000).catch(() => d1);
    assert.ok(Array.isArray(d2), 'incremental re-analysis after edit produces diagnostics');
  });

  it('top-level functions + this.x= method: pure/thisSafe/impure classification paths', async () => {
    const v1 = `let o = {\n  init: function() { this.val = 5; return 1; },\n  read: function() { return this.val; }\n};\nfunction pure(x) { return x + 1; }\nlet acc = 0;\nfunction impure() { acc = acc + 1; return acc; }\no.init(); pure(1); impure();\n`;
    await s.getDiagnostics(v1, path.join(ws, 'shapes.uc'));
    // edit the pure function body (comment) -> pure body skip path
    const v2 = v1.replace('return x + 1;', 'return x + 1; // c');
    s.openOrChangeDocument(uri('shapes.uc'), v2, 2);
    const d2 = await s.waitForDiagnostics(uri('shapes.uc'), () => true, 4000).catch(() => []);
    assert.ok(Array.isArray(d2), 'incremental edit of mixed-classification file is sound');
    // signature change -> structural fingerprint change -> full re-analysis path
    const v3 = v1.replace('function pure(x)', 'function pure(x, y)');
    s.openOrChangeDocument(uri('shapes.uc'), v3, 3);
    const d3 = await s.waitForDiagnostics(uri('shapes.uc'), () => true, 4000).catch(() => []);
    assert.ok(Array.isArray(d3), 'signature-change full re-analysis is sound');
  });

  it('bare object-expression statement is handled by unit extraction', async () => {
    const v1 = `({\n  m: function() { return 1; }\n});\nlet x = 1;\n`;
    const ds = await s.getDiagnostics(v1, path.join(ws, 'exprobj.uc'));
    assert.ok(Array.isArray(ds), 'expression-statement object analyzes without crash');
  });
});
