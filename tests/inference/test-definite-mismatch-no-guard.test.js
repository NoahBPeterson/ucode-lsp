// Regression for two quick-fix bugs on `incompatible-function-argument`:
//
//  (1) A DEFINITE type mismatch — a literal (or any provably-single wrong type)
//      passed where another type is required — used to offer "Extract … and add
//      type guard". A guard is dead code there (`type(1) == "string"` is always
//      false), and for a literal there's nothing to guard. Now no guard is offered.
//
//  (2) The extract-to-ternary fix swallowed a trailing line comment into the RHS,
//      pushing the `: null;` past the comment → `… ? f(_val); // c : null;` which
//      fails to parse ("Expected ':' after '?'"). The comment is now split off and
//      re-appended after the ternary.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics, getCodeActions;
beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

function applyEdits(text, edits) {
  const lines = text.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  for (const e of [...edits].sort((a, b) => off(b.range.start) - off(a.range.start)))
    text = text.slice(0, off(e.range.start)) + e.newText + text.slice(off(e.range.end));
  return text;
}

const JSDOC = '/**\n * @param {string} x\n */\n';

async function actionsFor(code, file, wantCode = 'incompatible-function-argument') {
  const diags = await getDiagnostics(code, file);
  const diag = diags.find((d) => d.code === wantCode);
  if (!diag) return { diag: null, actions: [] };
  const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  return { diag, actions };
}

describe('definite type-mismatch: no useless guard', () => {
  test('literal arg of the wrong type offers no type-guard fix', async () => {
    const { diag, actions } = await actionsFor(`${JSDOC}const f = function(x) { return substr(x, 0); };\nlet a = f(1);\nprint(a);\n`, '/tmp/dm-literal.uc');
    expect(diag).toBeDefined();
    expect(actions.some((a) => /guard/i.test(a.title))).toBe(false);
  });

  test('literal arg with a trailing comment offers no type-guard fix (was: broken ternary)', async () => {
    const { diag, actions } = await actionsFor(`${JSDOC}const f = function(x) { return substr(x, 0); };\nlet a = f(1); // bad\nprint(a);\n`, '/tmp/dm-literal-comment.uc');
    expect(diag).toBeDefined();
    expect(actions.some((a) => /guard/i.test(a.title))).toBe(false);
  });

  test('a narrowable arg (unknown param) STILL offers a guard (no over-suppression)', async () => {
    const { diag, actions } = await actionsFor('function f(x) {\n    return split(x, ",");\n}\n', '/tmp/dm-narrowable.uc');
    expect(diag).toBeDefined();
    expect(actions.some((a) => /type guard for `x`/i.test(a.title))).toBe(true);
  });
});

describe('extract-to-ternary preserves a trailing comment', () => {
  test('the ternary `: null;` lands before the comment and the code parses', async () => {
    const code = 'function maybeNull(x) { return x > 5 ? null : "hi"; }\nlet a = split(maybeNull(3), ","); // keepme\nprint(a);\n';
    const file = '/tmp/dm-ternary.uc';
    const { diag, actions } = await actionsFor(code, file, 'nullable-argument');
    expect(diag).toBeDefined();
    const extract = actions.find((a) => /extract/i.test(a.title));
    expect(extract).toBeDefined();
    const fixed = applyEdits(code, Object.values(extract.edit.changes)[0]);
    expect(fixed).toContain('? split(_val, ",") : null;');
    expect(fixed).toContain('// keepme');
    // re-analyze: no parser error
    const diags2 = await getDiagnostics(fixed, `${file}.fixed.uc`);
    expect(diags2.filter((d) => /Expected ':'|conditional/i.test(d.message))).toEqual([]);
  });
});
