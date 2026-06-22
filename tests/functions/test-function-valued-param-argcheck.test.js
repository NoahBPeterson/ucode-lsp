// Regression: a function-valued variable (`const f = (x) => …` or
// `const f = function(x){…}`) must argument-check its call sites against the
// param types — including JSDoc `@param {T}` annotations — exactly like a named
// `function f(x){…}` already does. Previously only the return type was stamped
// onto the variable symbol (0.6.193); `.parameters` was missing, so the call-site
// validator (`checkUserFunctionCall`, gated on `symbol.parameters`) was skipped
// and `f(1)` against `@param {string} x` produced no diagnostic.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics;
beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
});

const JSDOC = '/**\n * @param {string} x\n */\n';

async function argDiags(code, file) {
  const diags = await getDiagnostics(code, file);
  return diags.filter((d) => d.code === 'incompatible-function-argument');
}

describe('function-valued variable call-site argument checking', () => {
  test('arrow + @param {string}: wrong-type call flagged', async () => {
    const d = await argDiags(`${JSDOC}const f = (x) => substr(x, 0);\nf(1);\n`, '/tmp/fvp-arrow.uc');
    expect(d.length).toBe(1);
    expect(d[0].message).toMatch(/expected 'string'/);
  });

  test('function expression + @param {string}: wrong-type call flagged', async () => {
    const d = await argDiags(`${JSDOC}const f = function(x) { return substr(x, 0); };\nf(1);\n`, '/tmp/fvp-fnexpr.uc');
    expect(d.length).toBe(1);
    expect(d[0].message).toMatch(/expected 'string'/);
  });

  test('correct-type call is NOT flagged', async () => {
    const d = await argDiags(`${JSDOC}const f = (x) => substr(x, 0);\nf("hi");\n`, '/tmp/fvp-ok.uc');
    expect(d.length).toBe(0);
  });

  test("strict mode escalates the wrong-type call (still reported)", async () => {
    const d = await argDiags(`'use strict';\n${JSDOC}const f = function(x) { return substr(x, 0); };\nf(1);\n`, '/tmp/fvp-strict.uc');
    expect(d.length).toBe(1);
  });

  test('un-annotated function-valued variable does not over-flag (unknown param type)', async () => {
    const d = await argDiags(`const f = (x) => x + 1;\nf(1);\nf("s");\n`, '/tmp/fvp-noanno.uc');
    expect(d.length).toBe(0);
  });
});
