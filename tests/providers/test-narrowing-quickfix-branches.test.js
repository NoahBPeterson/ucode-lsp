// E2e code-action tests for less-common generateTypeNarrowingQuickFixes branches
// in server.ts that the main narrowing suite doesn't reach: a guard target whose
// declaration is on the SAME line as the diagnostic (inline insert), a diagnostic
// inside a MULTI-LINE call expression (guard redirected before the statement),
// and a nullable MEMBER-EXPRESSION argument (non-simple-identifier path).
//
// Recipe: maybeNull(x) returns `string | null`, so split(<nullable>, ",") raises
// a `nullable-argument` diagnostic that drives the quick-fix generator.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics, getCodeActions;
const MAYBE = 'function maybeNull(x) { return x > 5 ? null : "hello"; }\n';

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

async function actionsFor(code, file) {
  const diags = await getDiagnostics(code, file);
  const diag = diags.find((d) => d.code === 'nullable-argument');
  if (!diag) return { diag: null, actions: [], diags };
  const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  return { diag, actions, diags };
}

describe('generateTypeNarrowingQuickFixes edge branches (e2e)', () => {
  test('guard target declared on the same line → inline guard insert', async () => {
    const code = MAYBE + 'function process() { let val = maybeNull(3); return split(val, ","); }\n';
    const { diag, actions } = await actionsFor(code, '/tmp/qf-inline.uc');
    expect(diag).toBeDefined();
    expect(actions.some((a) => /null guard/i.test(a.title))).toBe(true);
  });

  test('diagnostic inside a multi-line call → guard redirected before statement', async () => {
    const code = MAYBE +
      'function process() {\n' +
      '    let val = maybeNull(3);\n' +
      '    let parts = split(\n' +
      '        val, ",");\n' +
      '    return parts;\n' +
      '}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/qf-multiline.uc');
    expect(diag).toBeDefined();
    expect(actions.some((a) => /null guard/i.test(a.title))).toBe(true);
  });

  test('top-level `let x = call(nullable)` used later → split-declaration guard', async () => {
    // No enclosing function (no `return` for an early guard) and `out` is used later (a wrap
    // would scope it out) → the only offered fix is the scope-preserving split declaration.
    const code = MAYBE + "let val = maybeNull(3);\nlet out = split(val, \",\");\nprint(out);\n";
    const file = '/tmp/qf-split.uc';
    const { diag, actions } = await actionsFor(code, file);
    expect(diag).toBeDefined();
    const split = actions.find((a) => /Guard the assignment/.test(a.title));
    expect(split).toBeTruthy();
    const out = split.edit.changes[`file://${file}`][0].newText;
    // preserves the declaration (out stays in scope) and guards on val
    expect(/let out;/.test(out)).toBe(true);
    expect(/if \(val != null\)/.test(out)).toBe(true);
    expect(/out = split\(val, ","\);/.test(out)).toBe(true);
  });

});

// The non-null (type-mismatch) branch: an UNKNOWN-typed arg passed to a builtin
// that wants a specific type raises `incompatible-function-argument`, whose
// quick fix offers a `type(x) == "string"` guard (vs. the `x == null` guard for
// nullable args). Each shape exercises a different guard-placement sub-branch.
describe('type-mismatch (incompatible-function-argument) guard branches (e2e)', () => {
  async function tmActionsFor(code, file) {
    const diags = await getDiagnostics(code, file);
    const diag = diags.find((d) => d.code === 'incompatible-function-argument');
    if (!diag) return { diag: null, actions: [], diags };
    const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
    return { diag, actions, diags };
  }

  test('type guard in a function body uses type(x) and return', async () => {
    const code = 'function f(x) {\n    return split(x, ",");\n}\n';
    const { diag, actions } = await tmActionsFor(code, '/tmp/qf-tm-fn.uc');
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /type guard for `x`/i.test(a.title));
    expect(guard).toBeDefined();
    const text = Object.values(guard.edit.changes)[0].map((e) => e.newText).join('');
    expect(text).toContain('type(x) != "string"'); // early-return when the type is wrong
    expect(text).toContain('return');
  });

  test('type guard inside a loop uses continue', async () => {
    const code = 'function f(items) {\n    for (let x in items) {\n        split(x, ",");\n    }\n}\n';
    const { diag, actions } = await tmActionsFor(code, '/tmp/qf-tm-loop.uc');
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /type guard for `x`/i.test(a.title));
    expect(guard).toBeDefined();
    const text = Object.values(guard.edit.changes)[0].map((e) => e.newText).join('');
    expect(text).toContain('continue');
  });

  test('type guard for a one-liner control body rewrites it to a block', async () => {
    const code = 'function f(x) {\n    while (true) split(x, ",");\n}\n';
    const { diag, actions } = await tmActionsFor(code, '/tmp/qf-tm-oneliner.uc');
    expect(diag).toBeDefined();
    expect(actions.some((a) => /type guard for `x`/i.test(a.title))).toBe(true);
  });
});
