// #21 — completion must not fire inside string literals or comments (a `.` in prose/path/URL
// shouldn't pop the builtin list). #22 — `this.` inside an object method offers the enclosing
// object's properties (the analyzer already tracks them for hover/diagnostics).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const at = async (code, l, c) => ((await s.getCompletions(code, `/tmp/scc-${n++}.uc`, l, c)) ?? []).map((x) => x.label ?? x);
const labelsOf = (r) => (r?.items ?? r ?? []).map((x) => x.label ?? x);

// ── #21 suppress inside strings / comments ──
test('no completion inside a string literal', async () => {
  // let x = 'hello.world';  — '.' at 14, cursor after it = 15
  expect((await at("let x = 'hello.world';\n", 0, 15)).length).toBe(0);
});
test('no completion inside a line comment', async () => {
  expect((await at("let y = 1; // a.b\n", 0, 16)).length).toBe(0);
});
test('no completion inside a block comment', async () => {
  expect((await at("let z = 1;\n/* obj.\n*/\n", 1, 7)).length).toBe(0);
});
test('completion still works at a normal position (not over-suppressed)', async () => {
  expect(await at('let q = pr\n', 0, 10)).toContain('print');
});
test('import-path completion inside the from-string still works', async () => {
  // the string-suppression must NOT swallow `import { x } from 'f|'`
  const c = await at("import { open } from 'fs';\n", 0, 22);
  expect(c).toContain('fs');
});

// ── #22 this. inside an object method ──
test('this. offers the enclosing object members', async () => {
  const code = "let o = {\n    n: 5,\n    m: 'x',\n    go: function() { return this.; }\n};\n";
  const c = await at(code, 3, 33); // right after `this.`
  expect(c).toContain('n');
  expect(c).toContain('m');
  expect(c).toContain('go');
  expect(c).not.toContain('print'); // not the global fallback
});
