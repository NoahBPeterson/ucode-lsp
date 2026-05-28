const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Two related bugs fixed in 0.6.81:
//
// (1) `for (varname in iterable)` (no `let`) used to declare `varname` as
//     bare UNKNOWN — no element-type inference, no keys-of provenance tagging.
//     Only the `for (let varname in iterable)` form benefited. Parity fixed.
//
// (2) The iterator variable was already in scope while the user was still
//     typing the iterable expression, so completion offered it. Now hidden
//     via Symbol.visibleFrom = body.start; only completion honours it
//     (hover/definition unchanged).
describe('for-in: bare iterator typing + completion visibility', function() {
  this.timeout(20000);

  const wsRoot = '/tmp/test-forin-bare-iterator';
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
    const lineIdx = lines.findIndex(l => l.includes('let ' + varName) || l.includes('const ' + varName));
    if (lineIdx < 0) throw new Error(`var ${varName} not declared`);
    const col = lines[lineIdx].indexOf(varName) + 2;
    return firstLine(await lspServer.getHover(code, file, lineIdx, col));
  }

  // ----- Bug 1: bare iterator gets the same treatment as `let` iterator -----

  it('`for (k in obj)` (no `let`) — obj[k] resolves via keys-of provenance', async function() {
    const code = [
      "'use strict';",
      "function gen_a() { return 'a'; }",
      "function gen_b() { return 'b'; }",
      "const m = { a: gen_a, b: gen_b };",
      "for (k in m) {",
      "    let result = m[k];",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'result');
    assert.ok(/function/.test(h), `expected function via for-in bare iter, got: ${h}`);
  });

  it('`for (k in keys(obj))` (no `let`) — obj[k] resolves via keys-of provenance', async function() {
    const code = [
      "'use strict';",
      "function gen_a() { return 'a'; }",
      "const m = { a: gen_a };",
      "for (k in keys(m)) {",
      "    let result = m[k];",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'result');
    assert.ok(/function/.test(h), `expected function via for-in over keys(), got: ${h}`);
  });

  // ----- Bug 2: completion filter -----

  it('completion in `for (X in <type-here>)` does NOT offer X', async function() {
    const code = [
      "'use strict';",
      "const data_generators = { a: 1, b: 2 };",
      "for (data_generator in dat",
      ''
    ].join('\n');
    // Position: end of line 2 ("for (data_generator in dat")
    const items = await lspServer.getCompletions(code, file, 2, 26);
    const offered = items.some(i => i.label === 'data_generator');
    assert.strictEqual(offered, false,
      'iterator variable must not appear in completion while typing the iterable');
    // Sanity: a SIBLING var with similar prefix IS still offered
    const siblingOffered = items.some(i => i.label === 'data_generators');
    assert.strictEqual(siblingOffered, true,
      'unrelated similar-prefix var should still complete');
  });

  it('inside the for-in body, the iterator IS offered', async function() {
    const code = [
      "'use strict';",
      "const data_generators = { a: 1, b: 2 };",
      "for (data_generator in data_generators) {",
      "    let v = data_g",
      "}",
      ''
    ].join('\n');
    const items = await lspServer.getCompletions(code, file, 3, 17);
    const offered = items.some(i => i.label === 'data_generator');
    assert.strictEqual(offered, true, 'iterator should complete inside the body');
  });

  // The user's actual pattern: `let x;` then `x = {...}` later (e.g. inside a
  // try block). visitAssignmentExpression updates currentType via SSA but
  // leaves the symbol's dataType as UNKNOWN (the first branch returns before
  // updateSymbolType). The access-time effType check now consults both, so
  // `m[k]` resolves through propertyTypes regardless of how m was assigned.
  it('decl-then-assign (no try) — for-in still resolves m[k] via keys-of', async function() {
    const code = [
      "'use strict';",
      "function gen_a() { return 'a'; }",
      "let m;",
      "m = { a: gen_a };",
      "for (k in keys(m)) {",
      "    let result = m[k];",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'result');
    assert.ok(/function/.test(h), `decl-then-assign should still work, got: ${h}`);
  });

  it('decl-then-assign INSIDE a try block — same coverage', async function() {
    // Real-world shape: `let data_generators; try { data_generators = {...}; } catch (e) {}`.
    const code = [
      "'use strict';",
      "function gen_a() { return 'a'; }",
      "let m;",
      "try { m = { a: gen_a }; } catch (e) {}",
      "for (k in keys(m)) {",
      "    let result = m[k];",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'result');
    assert.ok(/function/.test(h), `decl-then-assign in try should still work, got: ${h}`);
  });

  it('hover on the iterator inside the head still works (not a completion-only filter)', async function() {
    const code = [
      "'use strict';",
      "const data_generators = { a: 1, b: 2 };",
      "for (data_generator in data_generators) {",
      "    let v = data_generator;",
      "}",
      ''
    ].join('\n');
    // Hover on `data_generator` in the body (line 3) — should still resolve
    const lines = code.split('\n');
    const col = lines[3].indexOf('data_generator') + 2;
    const h = await lspServer.getHover(code, file, 3, col);
    assert.ok(h?.contents, 'hover on iterator in body should still work');
  });
});
