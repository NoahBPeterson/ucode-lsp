// Regression test for auto-docs finding #91:
// "Add type guard" / "Add null guard" quick fix inserted the guard OUTSIDE the
// function for a parameter of an expression-body arrow, a function expression,
// an object-literal method, or a callback — producing a top-level `return` and
// an out-of-scope variable reference (invalid ucode).
//
// The fix routes those cases to an inline-function-body insertion: the guard
// lands right after the block `{`, or, for an expression-body arrow, the body
// is rewritten to a block that early-returns on the guard then returns the
// original expression.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics, getCodeActions;

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

// Apply LSP TextEdits to a source string (end-to-start so offsets stay valid).
function applyEdits(text, edits) {
  const lines = text.split('\n');
  const off = (p) => {
    let o = 0;
    for (let i = 0; i < p.line; i++) o += lines[i].length + 1;
    return o + p.character;
  };
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  for (const e of sorted) text = text.slice(0, off(e.range.start)) + e.newText + text.slice(off(e.range.end));
  return text;
}

async function guardFor(code, file) {
  const diags = await getDiagnostics(code, file);
  const diag = diags.find((d) => d.code === 'incompatible-function-argument' || d.code === 'nullable-argument');
  if (!diag) return { diag: null, action: null, diags };
  const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  const action = actions.find((a) => /(type|null) guard for/i.test(a.title));
  return { diag, action, diags };
}

describe('#91 inline-function param type-guard placement', () => {
  const cases = {
    'expression-body arrow': `'use strict';\nconst f = (x) => substr(x, 0);\n`,
    'single-line function expression': `'use strict';\nconst f = function(x) { return substr(x, 0); };\n`,
    'object-literal method': `'use strict';\nlet o = { m: function(x) { return substr(x, 0); } };\n`,
    'callback argument': `'use strict';\nmap([1], function(x) { return substr(x, 0); });\n`,
  };

  for (const [name, code] of Object.entries(cases)) {
    test(`${name}: guard lands inside the function body, code stays valid`, async () => {
      const file = `/tmp/qf91-${name.replace(/\s+/g, '-')}.uc`;
      const { diag, action } = await guardFor(code, file);
      expect(diag).toBeDefined();
      expect(action).toBeDefined();

      const fixed = applyEdits(code, Object.values(action.edit.changes)[0]);
      // The guard must reference x where x is in scope — never hoisted to top level.
      expect(fixed).toContain('if (type(x) != "string") return;');
      // The original statement must be unchanged at the start of its line (guard
      // is NOT inserted before `const`/`let`/`map`).
      expect(/^if \(/m.test(fixed)).toBe(false);

      // Re-analyze the fixed source: no undeclared-variable / parse errors.
      const diags2 = await getDiagnostics(fixed, `${file}.fixed.uc`);
      const broken = diags2.filter((d) => /undeclared|undefined variable|Expected|Reference error/i.test(d.message));
      expect(broken.map((d) => d.message)).toEqual([]);
    });
  }

  test('inline-fn param does NOT offer a "Wrap" action (would guard the decl line, param out of scope)', async () => {
    const code = `'use strict';\nconst f1 = (x) => substr(x, 0);\n`;
    const file = '/tmp/qf91-nowrap.uc';
    const diags = await getDiagnostics(code, file);
    const diag = diags.find((d) => d.code === 'incompatible-function-argument' || d.code === 'nullable-argument');
    expect(diag).toBeDefined();
    const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
    const titles = actions.map((a) => a.title);
    expect(titles.some((t) => /Wrap in/i.test(t))).toBe(false);
    expect(titles.some((t) => /Add type guard for/i.test(t))).toBe(true);
  });

  test('a normal in-body statement STILL offers "Wrap" (no regression)', async () => {
    const code = `'use strict';\nfunction f(x) {\n    split(x, ",");\n}\n`;
    const file = '/tmp/qf91-wrap-ok.uc';
    const diags = await getDiagnostics(code, file);
    const diag = diags.find((d) => d.code === 'incompatible-function-argument');
    expect(diag).toBeDefined();
    const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
    expect(actions.some((a) => /Wrap in type guard/i.test(a.title))).toBe(true);
  });

  test('multi-line callback still inserts inside the block (no regression)', async () => {
    const code = `'use strict';\nmap([1], function(x) {\n    return substr(x, 0);\n});\n`;
    const { diag, action } = await guardFor(code, '/tmp/qf91-multiline.uc');
    expect(diag).toBeDefined();
    expect(action).toBeDefined();
    const fixed = applyEdits(code, Object.values(action.edit.changes)[0]);
    const diags2 = await getDiagnostics(fixed, '/tmp/qf91-multiline.fixed.uc');
    const broken = diags2.filter((d) => /undeclared|undefined variable|Expected|Reference error/i.test(d.message));
    expect(broken.map((d) => d.message)).toEqual([]);
  });
});
