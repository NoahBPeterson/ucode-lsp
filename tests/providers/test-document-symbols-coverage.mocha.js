// SERVER-DRIVEN coverage for documentSymbols.ts — drives textDocument/documentSymbol
// over the real server so the symbol builder runs inside the bundle.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('documentSymbols coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const names = (syms) => {
    const out = [];
    const walk = (arr) => { for (const x of (arr || [])) { if (x && x.name) out.push(x.name); walk(x.children); } };
    walk(syms);
    return out;
  };

  it('reports functions, nested functions, variables, objects, exports', async () => {
    const code = `
'use strict';
import { open } from 'fs';
const TOP = 42;
let counter = 0;
function outer(a, b) {
  function inner(x) { return x + 1; }
  let local = inner(a);
  return local + b;
}
let obj = {
  method: function(z) { return z; },
  arrow: (q) => q * 2,
  value: 7
};
export function shared() { return TOP; }
`;
    const syms = await s.getDocumentSymbols(code, path.join('/tmp', 'ds-main.uc'));
    assert.ok(Array.isArray(syms), 'returns a symbols array');
    const ns = names(syms);
    assert.ok(ns.includes('outer'), `expected 'outer' in symbols, got: ${JSON.stringify(ns)}`);
    assert.ok(ns.includes('shared'), `expected exported 'shared' in symbols, got: ${JSON.stringify(ns)}`);
  });

  it('handles an empty document without crashing', async () => {
    const syms = await s.getDocumentSymbols(`// just a comment\n`, path.join('/tmp', 'ds-empty.uc'));
    assert.ok(Array.isArray(syms) || syms === null, 'empty doc yields array or null, not a crash');
  });

  it('handles arrow-only and object-method-heavy files', async () => {
    const code = `
let handlers = {
  onStart: () => { return 1; },
  onStop: function() { return 2; },
  nested: { deep: function() { return 3; } }
};
let f = (a, b) => a + b;
let g = function named(x) { return x; };
`;
    const syms = await s.getDocumentSymbols(code, path.join('/tmp', 'ds-arrows.uc'));
    assert.ok(Array.isArray(syms), 'returns array for arrow/method-heavy file');
  });
});
