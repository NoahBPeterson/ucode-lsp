const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

// 0.6.84 — When you reassign a literal-initialized variable through
// `data_generators[k]()` (call result), then alias it via `let preview = data`,
// `preview` used to inherit data's ORIGINAL declared type (e.g. `null`) instead
// of the SSA-tracked currentType (whatever the call returned). Two places
// needed fixing — both consulted `sourceSymbol.dataType` directly without
// honouring `currentType` + `currentTypeEffectiveFrom`:
//   1) typeChecker.getNarrowedTypeAtPosition: now returns currentType when
//      it's active at the requested position, even without a guard.
//   2) semanticAnalyzer.processInitializerTypeInference's Identifier-init
//      branch: now copies the effective type from sourceSymbol, not the bare
//      dataType.
describe('SSA currentType propagation through variable aliasing', function() {
  this.timeout(20000);

  const wsRoot = '/tmp/test-ssa-aliasing';
  fs.mkdirSync(wsRoot, { recursive: true });
  const file = path.join(wsRoot, 'main.uc');
  let lspServer;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function firstLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }
  async function hoverVar(code, varName) {
    const lines = code.split('\n');
    const lineIdx = lines.findIndex(l => l.includes('let ' + varName));
    if (lineIdx < 0) throw new Error(`var ${varName} not declared`);
    const col = lines[lineIdx].indexOf(varName) + 2;
    return firstLine(await lspServer.getHover(code, file, lineIdx, col));
  }

  it('`let p = data` after `data = call()` propagates SSA type, not original null', async function() {
    // The user's exact shape: declared null, reassigned to a call result, then aliased.
    const code = [
      "'use strict';",
      "import * as fs from 'fs';",
      "function get_data() { return fs.popen('cmd').read('all'); }",  // chained call — LSP can't infer return type  // declared body irrelevant — the LSP only knows callee returns unknown
      "let data = null;",
      "data = get_data();",
      "let preview_var = data;",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'preview_var');
    assert.ok(!/^.*: `null`/.test(h),
      `preview should NOT inherit data's ORIGINAL null type after reassignment, got: ${h}`);
  });

  it('inside a null-narrowing guard, aliasing still reflects post-assignment type', async function() {
    const code = [
      "'use strict';",
      "import * as fs from 'fs';",
      "function get_data() { return fs.popen('cmd').read('all'); }",  // chained call — LSP can't infer return type
      "let data = null;",
      "data = get_data();",
      "if (data !== null && data !== '') {",
      "    let preview_var = data;",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'preview_var');
    assert.ok(!/^.*: `null`/.test(h),
      `preview inside null-guard must not type as null, got: ${h}`);
  });

  it('`type(x) == "string" && length(x) > 0` narrows x to string in the if-body (compound AND)', async function() {
    // 0.6.85: collectGuards now decomposes `&&` chains when extractTypeGuard
    // returns null on the compound test. Previously the `type(x) == "string"`
    // guard was ignored because it was on the LEFT of an &&, and only the
    // top-level expression was checked. Aliasing `let p = x;` inside the body
    // now correctly inherits `string`.
    const code = [
      "'use strict';",
      "import * as fs from 'fs';",
      "function get_data() { return fs.popen('cmd').read('all'); }",
      "let data = null;",
      "data = get_data();",
      "if (type(data) == 'string' && length(data) > 0) {",
      "    let preview_var = data;",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'preview_var');
    assert.ok(/string/.test(h),
      `expected string (from type(x) == "string" guard via && decomposition), got: ${h}`);
  });

  it('OBJECT reassignment: `let m; m = {…}; let m2 = m;` — m2 inherits the object', async function() {
    // Touches the same code path but with a real type to confirm it isn't
    // overcorrecting (i.e., now we propagate currentType when active, so
    // assigning to a previously-undeclared variable still works).
    const code = [
      "'use strict';",
      "let m;",
      "m = { a: 1 };",
      "let alias_obj = m;",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'alias_obj');
    assert.ok(/object/.test(h),
      `alias of reassigned object should type as object, got: ${h}`);
  });
});
