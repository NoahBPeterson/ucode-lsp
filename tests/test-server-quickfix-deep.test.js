// E2e code-action tests for deeper generateTypeNarrowingQuickFixes branches +
// its helper functions (findTightestTypeConstraint, findInnerGuardTarget /
// traceCallToGuardTarget / getDottedPath / findCallExpressionAtOffset,
// uniqueValName) in server.ts. Driven through the spawned server.
//
// Diagnostic recipes (verified against the analyzer):
//   maybeNull(x) returns `string | null`  → nullable-argument on split(<it>, ",")
//   unknown param x                        → incompatible-function-argument
//   <arg> || <validFallback> in strict mode → diagnostic carries fallback data
//   trim(<nullable>) as a builtin arg       → complex-expression (no varName) path

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let getDiagnostics, getCodeActions;
const M = 'function maybeNull(x){return x>5?null:"h";}\n';

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

// Request code actions for the first diagnostic matching `pick`.
async function actionsFor(code, file, pick) {
  const diags = await getDiagnostics(code, file);
  const diag = diags.find(pick);
  if (!diag) return { diag: null, actions: [], diags };
  const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  return { diag, actions, diags };
}
const editTextOf = (a) => (a && a.edit && a.edit.changes) ? Object.values(a.edit.changes)[0].map((e) => e.newText).join('') : '';

// Apply an action's TextEdits to `code` (end-to-start so offsets stay valid).
function applyAction(code, a) {
  const edits = Object.values(a.edit.changes)[0];
  const lines = code.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  let out = code;
  for (const e of [...edits].sort((x, y) => off(y.range.start) - off(x.range.start)))
    out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}

describe('server.ts quick-fix deep branches (e2e)', () => {
  test('nullable arg in a one-liner loop body → block-expanding guard with continue', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  while (true) split(val, ",");\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-oneliner.uc', (d) => d.code === 'nullable-argument');
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /null guard for `val`/i.test(a.title));
    expect(guard).toBeDefined();
    const text = editTextOf(guard);
    expect(text).toContain('if (val == null) continue;'); // one-liner rewritten to a block
  });

  test('nullable arg in a braceless if-body with else → guard inserted, else preserved', async () => {
    const code = M + 'function p(c){\n  let val = maybeNull(3);\n  if (c)\n    split(val, ",");\n  else\n    print("no");\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-braceless.uc', (d) => d.code === 'nullable-argument');
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /null guard for `val`/i.test(a.title));
    expect(guard).toBeDefined();
    // The fix replaces ONLY the braceless body node with a block, so the `else`
    // (untouched) is preserved in the applied result rather than re-emitted.
    const patched = applyAction(code, guard);
    expect(patched).toContain('if (val == null) return;');
    expect(patched).toContain('else');
    expect(patched).toContain('print("no")');
  });

  test('type-mismatch arg in a braceless if-body with else → type guard, else preserved', async () => {
    const code = 'function f(x, c) {\n  if (c)\n    split(x, ",");\n  else\n    print("x");\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-tm-braceless.uc', (d) => d.code === 'incompatible-function-argument');
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /type guard for `x`/i.test(a.title));
    expect(guard).toBeDefined();
    const patched = applyAction(code, guard);
    expect(patched).toContain('type(x) != "string"');
    expect(patched).toContain('print("x")');
    expect(patched).toContain('else');
  });

  test('arg `expr || fallback` in strict mode → "Add type guard with default"', async () => {
    const code = "'use strict';\nfunction f(x) { return split(x || \"d\", \",\"); }\n";
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-fallback.uc', (d) => d.data && d.data.fallbackStart != null);
    expect(diag).toBeDefined();
    const def = actions.find((a) => /type guard with default/i.test(a.title));
    expect(def).toBeDefined();
    const text = editTextOf(def);
    expect(text).toContain('= "d"');         // fallback assigned when type is wrong
    expect(text).toMatch(/type\(_\w+\) != "string"/); // guard on the extracted temp
  });

  test('multiple downstream usages tighten the type guard (findTightestTypeConstraint)', async () => {
    // length(x) allows string|array|object, but join("\n", x) requires array →
    // the guard should narrow to just array.
    const code = 'function f(x) {\n  let a = length(x);\n  return join("\\n", x);\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-tighten.uc',
      (d) => d.code === 'incompatible-function-argument' && d.range.start.line === 1);
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /type guard for `x`/i.test(a.title));
    expect(guard).toBeDefined();
    const text = editTextOf(guard);
    expect(text).toContain('type(x) != "array"');     // tightened to array
    expect(text).not.toContain('"string"');           // string/object dropped
  });

  test('complex-expression arg in a loop → inner guard with continue', async () => {
    const code = M + 'function p(){\n  for (let i in [1,2]) {\n    let line = maybeNull(i);\n    split(trim(line), ",");\n  }\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-complex-loop.uc',
      (d) => d.code === 'nullable-argument' && (d.data && d.data.variableName == null));
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /type guard for `line`/i.test(a.title));
    expect(guard).toBeDefined();
    expect(editTextOf(guard)).toContain('continue;');
  });

  test('complex-expression arg in a control condition → inner guard before the control', async () => {
    const code = M + 'function p(){\n  let line = maybeNull(3);\n  if (split(trim(line), ",")) { return 1; }\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-complex-cond.uc',
      (d) => d.code === 'nullable-argument' && (d.data && d.data.variableName == null));
    expect(diag).toBeDefined();
    expect(actions.some((a) => /type guard for `line`/i.test(a.title))).toBe(true);
  });

  test('complex-expression arg at top level → extract-to-variable with wrap guard', async () => {
    const code = M + 'let line = maybeNull(3);\nprint(split(trim(line), ","));\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-complex-toplevel.uc',
      (d) => d.code === 'nullable-argument' && (d.data && d.data.variableName == null));
    expect(diag).toBeDefined();
    // At top level (not in loop/function) the inner-guard path falls back to
    // extract-to-variable; the generator must still produce actions.
    expect(actions.length).toBeGreaterThan(0);
  });

  test('complex-expression with a member-path inner target (getDottedPath recursion)', async () => {
    const code = M + 'function p(){\n  let o = { f: maybeNull(3) };\n  return split(trim(o.f), ",");\n}\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-complex-member.uc',
      (d) => d.code === 'nullable-argument' && (d.data && d.data.variableName == null));
    expect(diag).toBeDefined();
    expect(actions.some((a) => /type guard for `o\.f`/i.test(a.title))).toBe(true);
  });

  test('tightening ignores a same-named param in a DIFFERENT function', async () => {
    // g(x) also calls length(x), but findTightestTypeConstraint must skip g's
    // usages when fixing f's diagnostic. join("\n", x) in f → narrow to array.
    // g is placed AFTER f so the constraint walk reaches it via the function-skip
    // branch (a function before the diagnostic is pruned by the offset check).
    const code = 'function f(x){\n  let a = length(x);\n  return join("\\n", x);\n}\n' +
      'function g(x){ return length(x); }\n';
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-tighten-difffn.uc',
      (d) => d.code === 'incompatible-function-argument' && d.range.start.line === 1);
    expect(diag).toBeDefined();
    const guard = actions.find((a) => /type guard for `x`/i.test(a.title));
    expect(guard).toBeDefined();
    expect(editTextOf(guard)).toContain('type(x) != "array"');
  });

  test('extracted temp name avoids colliding with an existing `_val` (uniqueValName)', async () => {
    const code = "'use strict';\nfunction f(x) {\n  let _val = 1;\n  return split(x || \"d\", \",\") + _val;\n}\n";
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-valcollide.uc',
      (d) => d.data && d.data.fallbackStart != null);
    expect(diag).toBeDefined();
    const def = actions.find((a) => /type guard with default/i.test(a.title));
    expect(def).toBeDefined();
    expect(editTextOf(def)).toContain('_val2'); // _val is taken → next name
  });

  test('`expr || fallback` inside a multi-line expression (strict) → redirected default guard', async () => {
    const code = "'use strict';\nfunction f(x) {\n  let o = {\n    k: split(x || \"d\", \",\")\n  };\n  return o;\n}\n";
    const { diag, actions } = await actionsFor(code, '/tmp/sqd-fallback-multiline.uc',
      (d) => d.data && d.data.fallbackStart != null);
    expect(diag).toBeDefined();
    const def = actions.find((a) => /type guard with default/i.test(a.title));
    expect(def).toBeDefined();
    expect(editTextOf(def)).toContain('= "d"');
  });
});
