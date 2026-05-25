// Correctness-focused quick-fix edge-case suite. Rather than asserting "an action
// exists", each case APPLIES the fix's TextEdits to the source and verifies:
//   (1) the patched code is well-formed (balanced braces), and
//   (2) re-analyzing the patched code RESOLVES the target diagnostic.
// This is the strongest guard against the subtle placement/scoping/indentation
// bugs that quick fixes are prone to. Heavy on type-narrowing shapes: one-liners,
// braceless bodies, loops, conditions, nested calls, members, unions, fallbacks.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let getDiagnostics, getCodeActions;
const M = 'function maybeNull(x){return x>5?null:"h";}\n'; // returns string | null
let uid = 0;
const freshFile = (tag) => `/tmp/qfe-${tag}-${uid++}.uc`;

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

// ── helpers ────────────────────────────────────────────────────────────────
function offsetAt(text, pos) {
  const ls = text.split('\n');
  let o = 0;
  for (let i = 0; i < pos.line; i++) o += ls[i].length + 1;
  return o + pos.character;
}
function applyEdits(text, edits) {
  const w = edits
    .map((e) => ({ nt: e.newText, s: offsetAt(text, e.range.start), en: offsetAt(text, e.range.end) }))
    .sort((a, b) => b.s - a.s);
  let out = text;
  for (const e of w) out = out.slice(0, e.s) + e.nt + out.slice(e.en);
  return out;
}
function bracesBalanced(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}
const editsOf = (a) => (a && a.edit && a.edit.changes) ? Object.values(a.edit.changes)[0] : null;

// Find the diagnostic, request its actions, return everything needed.
async function fixCtx(code, tag, pickDiag) {
  const file = freshFile(tag);
  const diags = await getDiagnostics(code, file);
  const diag = diags.find(pickDiag);
  if (!diag) return { diag: null, actions: [] };
  const actions = await getCodeActions(file, [diag], diag.range.start.line, diag.range.start.character);
  return { diag, actions };
}
// Apply `action` to `code`, re-analyze the patched text, return remaining diags.
async function applyAndReanalyze(code, action, tag) {
  const edits = editsOf(action);
  const patched = applyEdits(code, edits);
  const diags = await getDiagnostics(patched, freshFile(tag + '-patched'));
  return { patched, diags };
}
const countCode = (diags, code) => diags.filter((d) => d.code === code).length;

// ── 1. Nullable guard placement ─────────────────────────────────────────────
describe('nullable null-guard placement (apply + resolve)', () => {
  test('function body: early-return guard resolves the diagnostic', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  return split(val, ",");\n}\n';
    const { diag, actions } = await fixCtx(code, 'fn', (d) => d.code === 'nullable-argument');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'fn');
    expect(patched).toContain('if (val == null)');
    expect(patched).not.toContain('continue'); // not a loop → return
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('for-in loop body: uses continue and resolves', async () => {
    const code = M + 'function p(){\n  for (let i in [1,2]) {\n    let val = maybeNull(i);\n    split(val, ",");\n  }\n}\n';
    const { diag, actions } = await fixCtx(code, 'loop', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'loop');
    expect(patched).toContain('continue');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('while loop body: uses continue', async () => {
    const code = M + 'function p(){\n  let n = 3;\n  while (n > 0) {\n    let val = maybeNull(n);\n    split(val, ",");\n    n--;\n  }\n}\n';
    const { actions } = await fixCtx(code, 'while', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'while');
    expect(patched).toContain('if (val == null)');
    expect(patched).toContain('continue');
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('top level: wrap guard resolves (no early return available)', async () => {
    const code = M + 'let val = maybeNull(3);\nprint(split(val, ","));\n';
    const { actions } = await fixCtx(code, 'top', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Wrap in null guard for `val`/.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'top');
    expect(patched).toContain('if (val != null) {');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('nested function inside a loop resets loop context → return, not continue', async () => {
    const code = M +
      'function p(){\n  for (let i in [1,2]) {\n' +
      '    let cb = function(){\n      let val = maybeNull(i);\n      return split(val, ",");\n    };\n    cb();\n  }\n}\n';
    const { actions } = await fixCtx(code, 'nestfn', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'nestfn');
    // The guard is inside the callback, which is NOT a loop body → must use return.
    const guardLine = patched.split('\n').find((l) => l.includes('if (val == null)'));
    expect(guardLine).toBeDefined();
    expect(patched).not.toMatch(/if \(val == null\)\s*\n\s*continue/);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });
});

// ── 2. One-liner & braceless shapes ─────────────────────────────────────────
describe('one-liner & braceless shapes (apply + resolve)', () => {
  test('one-liner function with param: inline guard keeps it inside the body', async () => {
    const code = 'function f(x) { return split(x, ","); }\n';
    const { actions } = await fixCtx(code, 'ol-fn', (d) => d.code === 'incompatible-function-argument');
    const a = actions.find((x) => /type guard for `x`/.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'ol-fn');
    expect(bracesBalanced(patched)).toBe(true);
    expect(patched).toContain('type(x) != "string"');
    expect(countCode(diags, 'incompatible-function-argument')).toBe(0);
  });

  test('one-liner control body (while …) expands to a block', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  while (true) split(val, ",");\n}\n';
    const { actions } = await fixCtx(code, 'ol-while', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'ol-while');
    expect(bracesBalanced(patched)).toBe(true);
    expect(patched).toContain('{'); // body became a block
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('braceless if-body (next line) expands to a block and resolves', async () => {
    const code = M + 'function p(c){\n  let val = maybeNull(3);\n  if (c)\n    split(val, ",");\n}\n';
    const { actions } = await fixCtx(code, 'bl-if', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'bl-if');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('braceless if-body WITH else: the else clause survives the block expansion', async () => {
    const code = M + 'function p(c){\n  let val = maybeNull(3);\n  if (c)\n    split(val, ",");\n  else\n    print("no");\n}\n';
    const { actions } = await fixCtx(code, 'bl-else', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'bl-else');
    expect(bracesBalanced(patched)).toBe(true);
    expect(patched).toContain('else');          // not orphaned
    expect(patched).toContain('print("no")');
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });
});

// ── 3. Statement redirect & condition context ───────────────────────────────
describe('statement-redirect & condition context (apply + resolve)', () => {
  test('multi-line call: guard inserted before the whole statement', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  let parts = split(\n    val, ",");\n  return parts;\n}\n';
    const { diag, actions } = await fixCtx(code, 'ml', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'ml');
    expect(bracesBalanced(patched)).toBe(true);
    // The guard must come before `let parts = split(`, not between split( and val.
    const gi = patched.indexOf('if (val == null)');
    const si = patched.indexOf('let parts = split');
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(gi).toBeLessThan(si);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('diagnostic in an if-condition: guard goes before the if and resolves', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  if (length(split(val, ",")) > 0) {\n    return 1;\n  }\n}\n';
    const { diag, actions } = await fixCtx(code, 'cond', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'cond');
    expect(bracesBalanced(patched)).toBe(true);
    const gi = patched.indexOf('if (val == null)');
    const ci = patched.indexOf('if (length(split');
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(gi).toBeLessThan(ci); // guard precedes the control structure
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });
});

// ── 4. Complex (nested-call / member) expressions ───────────────────────────
describe('complex-expression inner guards (apply + resolve)', () => {
  test('nested call split(trim(line)): guard targets the inner variable', async () => {
    const code = M + 'function p(){\n  let line = maybeNull(3);\n  return split(trim(line), ",");\n}\n';
    const { diag, actions } = await fixCtx(code, 'nest', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'line');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /guard for `line`/.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'nest');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });

  test('nested call in a loop body uses continue', async () => {
    const code = M + 'function p(){\n  for (let i in [1,2]) {\n    let line = maybeNull(i);\n    split(trim(line), ",");\n  }\n}\n';
    const { actions } = await fixCtx(code, 'nestloop', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'line');
    const a = actions.find((x) => /guard for `line`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'nestloop');
    expect(patched).toContain('continue');
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });
});

// ── 5. Type-mismatch (incompatible-function-argument) ───────────────────────
describe('type-mismatch guards (apply + resolve)', () => {
  test('function body: type(x) != "string" guard resolves', async () => {
    const code = 'function f(x) {\n  return split(x, ",");\n}\n';
    const { actions } = await fixCtx(code, 'tm-fn', (d) => d.code === 'incompatible-function-argument');
    const a = actions.find((x) => /type guard for `x`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'tm-fn');
    expect(patched).toContain('type(x) != "string"');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'incompatible-function-argument')).toBe(0);
  });

  test('downstream usages tighten the guard to a single type and resolve', async () => {
    const code = 'function f(x) {\n  let a = length(x);\n  return join("\\n", x);\n}\n';
    const { actions } = await fixCtx(code, 'tighten', (d) => d.code === 'incompatible-function-argument' && d.range.start.line === 1);
    const a = actions.find((x) => /type guard for `x`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'tighten');
    expect(patched).toContain('type(x) != "array"');
    expect(patched).not.toContain('"string"');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'incompatible-function-argument')).toBe(0);
  });
});

// ── 6. || fallback (strict mode) ────────────────────────────────────────────
describe('|| fallback "type guard with default" (apply + resolve)', () => {
  test('split(x || "d", ",") in strict mode → extract temp, default, resolve', async () => {
    const code = "'use strict';\nfunction f(x) { return split(x || \"d\", \",\"); }\n";
    const { diag, actions } = await fixCtx(code, 'fb', (d) => d.data && d.data.fallbackStart != null);
    expect(diag).toBeDefined();
    const a = actions.find((x) => /type guard with default/i.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'fb');
    expect(bracesBalanced(patched)).toBe(true);
    expect(patched).toContain('= "d"');
    // After extraction+guard, the strict-mode arg error must be gone.
    expect(countCode(diags, 'nullable-argument') + countCode(diags, 'incompatible-function-argument')).toBe(0);
  });
});

// ── 7. Scoping safety ───────────────────────────────────────────────────────
describe('wrapping-guard scoping safety', () => {
  test('does NOT offer a wrapping guard when the declared var is used later', async () => {
    // Wrapping `let parts = split(val, ...)` would scope `parts` inside the if,
    // breaking the later `print(parts)`. The wrap action must be suppressed.
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  let parts = split(val, ",");\n  print(parts);\n  return parts;\n}\n';
    const { actions } = await fixCtx(code, 'scope', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    expect(actions.some((x) => /Add null guard for `val`/.test(x.title))).toBe(true);
    expect(actions.some((x) => /Wrap in null guard/.test(x.title))).toBe(false);
  });

  test('offers a wrapping guard when no variable is declared on the line', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  print(split(val, ","));\n}\n';
    const { actions } = await fixCtx(code, 'scope2', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Wrap in null guard for `val`/.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'scope2');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });
});

// ── 8. Format correctness ───────────────────────────────────────────────────
describe('guard format correctness', () => {
  test('early-exit guard uses if WITHOUT braces', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  return split(val, ",");\n}\n';
    const { actions } = await fixCtx(code, 'fmt1', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    const text = editsOf(a).map((e) => e.newText).join('');
    expect(text).toMatch(/if \(val == null\)\s*\n\s*return;/);
    expect(text).not.toContain('if (val == null) {');
  });

  test('wrapping guard uses braces', async () => {
    const code = M + 'function p(){\n  let val = maybeNull(3);\n  print(split(val, ","));\n}\n';
    const { actions } = await fixCtx(code, 'fmt2', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Wrap in null guard for `val`/.test(x.title));
    const text = editsOf(a).map((e) => e.newText).join('');
    expect(text).toContain('if (val != null) {');
    expect(text).toContain('}');
  });

  test('nested guard preserves the original indentation', async () => {
    const code = M + 'function p(){\n  if (true) {\n    let val = maybeNull(3);\n    split(val, ",");\n  }\n}\n';
    const { actions } = await fixCtx(code, 'fmt3', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    const text = editsOf(a).map((e) => e.newText).join('');
    expect(text).toMatch(/^\s{4}if \(val == null\)/m); // 4-space indent (inside two blocks)
  });
});

// ── 9. Hostile control-structure shapes (apply + resolve + well-formed) ──────
const MA = 'function maybeArr(x){return x>5?null:[1,2];}\n';
describe('hostile control-structure shapes (apply + resolve)', () => {
  const guardResolves = async (code, tag, pick, titleRe, extra) => {
    const { diag, actions } = await fixCtx(code, tag, pick);
    expect(diag).toBeDefined();
    const a = actions.find((x) => titleRe.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, tag);
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, diag.code)).toBe(0);
    if (extra) extra(patched);
    return patched;
  };

  test('switch/case body', async () => {
    const code = M + 'function p(k){\n  switch(k){\n  case 1:\n    let val = maybeNull(3);\n    split(val, ",");\n    break;\n  }\n}\n';
    await guardResolves(code, 'sw', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val', /null guard for `val`/);
  });

  test('try block body', async () => {
    const code = M + 'function p(){\n  try {\n    let val = maybeNull(3);\n    split(val, ",");\n  } catch(e) {}\n}\n';
    await guardResolves(code, 'try', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val', /null guard for `val`/);
  });

  test('arrow-function body (return, not continue)', async () => {
    const code = M + 'let f = () => {\n  let val = maybeNull(3);\n  return split(val, ",");\n};\n';
    const patched = await guardResolves(code, 'arrow', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val', /null guard for `val`/);
    expect(patched).not.toContain('continue');
  });

  test('C-style for loop body (continue)', async () => {
    const code = M + 'function p(){\n  for (let i = 0; i < 3; i++) {\n    let val = maybeNull(i);\n    split(val, ",");\n  }\n}\n';
    const patched = await guardResolves(code, 'cfor', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val', /null guard for `val`/);
    expect(patched).toContain('continue');
  });

  test('tab-indented body keeps tab indentation and resolves', async () => {
    const code = M + 'function p(){\n\tlet val = maybeNull(3);\n\treturn split(val, ",");\n}\n';
    const patched = await guardResolves(code, 'tabs', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val', /null guard for `val`/);
    expect(patched).toMatch(/\n\tif \(val == null\)/); // guard line is tab-indented
  });

  test('braceless else-if body', async () => {
    const code = M + 'function p(c,d){\n  let val = maybeNull(3);\n  if (c)\n    print("c");\n  else if (d)\n    split(val, ",");\n}\n';
    const patched = await guardResolves(code, 'elseif', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val', /null guard for `val`/);
    expect(patched).toContain('print("c")'); // the if branch survives
  });

  test('deeply nested member path (o.a.b) type guard', async () => {
    const code = M + 'function p(){\n  let o = { a: { b: maybeNull(3) } };\n  return split(o.a.b, ",");\n}\n';
    await guardResolves(code, 'deepmem',
      (d) => d.code === 'incompatible-function-argument' && d.data?.variableName === 'o.a.b',
      /type guard for `o\.a\.b`/);
  });

  test('iterating a nullable array in a for-in header is not falsely flagged', async () => {
    // Regression sanity: `for (k in <array|null>)` should not raise a nullable-arg
    // diagnostic (so there is nothing to "fix" here).
    const code = MA + 'function p(){\n  let a = maybeArr(3);\n  for (let k in a) { print(k); }\n}\n';
    const file = freshFile('forin');
    const diags = await getDiagnostics(code, file);
    expect(diags.filter((d) => d.code === 'nullable-argument').length).toBe(0);
  });
});

// ── 10. Multiple diagnostics on one line ────────────────────────────────────
describe('multiple nullable args on one line', () => {
  test('fixing the first leaves the second flagged; fixing both resolves all', async () => {
    // split(a, b): arg0 (string) and arg1 (separator string|regex) are both nullable.
    const code = M + 'function p(){\n  let a = maybeNull(1);\n  let b = maybeNull(2);\n  return split(a, b);\n}\n';
    const file = freshFile('multi');
    let diags = await getDiagnostics(code, file);
    const nulls = diags.filter((d) => d.code === 'nullable-argument');
    expect(nulls.length).toBe(2); // both a and b

    // Fix `a`.
    const da = nulls.find((d) => d.data?.variableName === 'a');
    const aActs = await getCodeActions(file, [da], da.range.start.line, da.range.start.character);
    const aGuard = aActs.find((x) => /null guard for `a`/.test(x.title));
    let patched = applyEdits(code, editsOf(aGuard));
    diags = await getDiagnostics(patched, freshFile('multi-a'));
    expect(diags.filter((d) => d.code === 'nullable-argument' && d.data?.variableName === 'a').length).toBe(0);
    expect(diags.filter((d) => d.code === 'nullable-argument' && d.data?.variableName === 'b').length).toBe(1);

    // Now fix `b` on the patched code.
    const f2 = freshFile('multi-b');
    diags = await getDiagnostics(patched, f2);
    const db = diags.find((d) => d.code === 'nullable-argument' && d.data?.variableName === 'b');
    const bActs = await getCodeActions(f2, [db], db.range.start.line, db.range.start.character);
    const bGuard = bActs.find((x) => /null guard for `b`/.test(x.title));
    patched = applyEdits(patched, editsOf(bGuard));
    diags = await getDiagnostics(patched, freshFile('multi-done'));
    expect(bracesBalanced(patched)).toBe(true);
    expect(diags.filter((d) => d.code === 'nullable-argument').length).toBe(0);
  });
});

// ── 11. Alternative fix paths (JSDoc / Extract / union / CRLF) ───────────────
describe('alternative fix paths (apply + resolve)', () => {
  test('JSDoc annotation fix types the param and resolves the diagnostic', async () => {
    const code = 'function f(x) {\n  return substr(x, 0, 3);\n}\n';
    const { diag, actions } = await fixCtx(code, 'jsdoc', (d) => d.code === 'incompatible-function-argument');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /Add JSDoc/.test(x.title));
    expect(a).toBeDefined();
    const { patched, diags } = await applyAndReanalyze(code, a, 'jsdoc');
    expect(patched).toMatch(/@param \{string\} x/);
    expect(countCode(diags, 'incompatible-function-argument')).toBe(0);
  });

  test('union-typed type guard lists every allowed type and resolves', async () => {
    // length() accepts string|array|object → the early-exit guard must exclude all
    // three with && so the body sees a narrowed value.
    const code = 'function f(x) {\n  return length(x);\n}\n';
    const { actions } = await fixCtx(code, 'union', (d) => d.code === 'incompatible-function-argument');
    const a = actions.find((x) => /type guard for `x`/.test(x.title));
    const text = editsOf(a).map((e) => e.newText).join('');
    expect(text).toContain('&&'); // compound guard for the union
    for (const t of ['string', 'array', 'object']) expect(text).toContain(`type(x) != "${t}"`);
    const { patched, diags } = await applyAndReanalyze(code, a, 'union');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'incompatible-function-argument')).toBe(0);
  });

  test('Extract action for an untraceable nested call produces valid code', async () => {
    // length(uc(trim(line))) — uc() is a user function so the inner target can't be
    // traced; the generator falls back to "Extract `trim(line)` and add ... guard".
    const code = M + 'function p(){\n  let line = maybeNull(3);\n  return length(uc(trim(line)));\n}\nfunction uc(s){return s;}\n';
    const { diag, actions } = await fixCtx(code, 'extract',
      (d) => (d.code === 'incompatible-function-argument' || d.code === 'nullable-argument') && d.data?.variableName == null);
    expect(diag).toBeDefined();
    const a = actions.find((x) => /Extract .* guard/i.test(x.title));
    expect(a).toBeDefined();
    const { patched } = await applyAndReanalyze(code, a, 'extract');
    expect(bracesBalanced(patched)).toBe(true);
    // The extracted temp is declared and used in place of the original expression.
    expect(patched).toMatch(/let _val\d? = trim\(line\);/);
  });

  test('CRLF line endings: edits land at the right offsets and resolve', async () => {
    const code = (M + 'function p(){\n  let val = maybeNull(3);\n  return split(val, ",");\n}\n').replace(/\n/g, '\r\n');
    const { diag, actions } = await fixCtx(code, 'crlf', (d) => d.code === 'nullable-argument' && d.data?.variableName === 'val');
    expect(diag).toBeDefined();
    const a = actions.find((x) => /Add null guard for `val`/.test(x.title));
    const { patched, diags } = await applyAndReanalyze(code, a, 'crlf');
    expect(patched).toContain('if (val == null)');
    expect(bracesBalanced(patched)).toBe(true);
    expect(countCode(diags, 'nullable-argument')).toBe(0);
  });
});
