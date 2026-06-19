// `require("builtin-module")` is generically typed as that module — wherever it
// appears, not just at a `let x = require()` binding. So the module type flows through
// the normal property-assignment / variable / member-read / member-call machinery.
// (File-path requires, inline member-calls, and a few other follow-ups are tracked in
// docs/planned-type-inference-todos.md.)
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// hover type of the last occurrence of `needle`
async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/rbt-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}
const errs = async (code) => (await server.getDiagnostics(code, `/tmp/rbt-${n++}.uc`) || []).filter((x) => x.severity === 1);

// ── Module type via property assignment ──────────────────────────────────────
test('01 obj.x = require("fs"); a = obj.x → a is the fs module', async () => {
  expect(await typeOf('function f(){ let o={}; o.x = require("fs"); let a = o.x; }\n', 'a')).toContain('fs module');
});
test('02 param: ctx.fs = require("fs"); a = ctx.fs → a is the fs module', async () => {
  expect(await typeOf('function f(ctx){ ctx.fs = require("fs"); let a = ctx.fs; }\n', 'a')).toContain('fs module');
});
test('03 require("math") → math module', async () => {
  expect(await typeOf('function f(){ let o={}; o.m = require("math"); let a = o.m; }\n', 'a')).toContain('math module');
});
test('04 require("ubus") → ubus module', async () => {
  expect(await typeOf('function f(){ let o={}; o.u = require("ubus"); let a = o.u; }\n', 'a')).toContain('ubus module');
});

// ── Flows to member calls (via a variable) ───────────────────────────────────
test('05 a = obj.fs(module); a.glob("x") resolves to array<string> | null', async () => {
  expect(await typeOf('function f(){ let o={}; o.fs = require("fs"); let a = o.fs; let g = a.glob("x"); }\n', 'g')).toContain('array<string> | null');
});
test('06 calling a method on a module-typed var emits no "use module" error', async () => {
  expect(await errs('function f(){ let o={}; o.fs = require("fs"); let a = o.fs; a.glob("x"); }\n')).toEqual([]);
});
test('07 the existing `let m = require("fs"); m.glob()` still resolves (regression)', async () => {
  expect(await typeOf('function f(){ let m = require("fs"); let g = m.glob("x"); }\n', 'g')).toContain('array<string> | null');
});

// ── Most-recent semantics (no unsoundness) ───────────────────────────────────
test('08 let m = require("fs"); m = 5; z = m → integer (most recent wins)', async () => {
  expect(await typeOf('function f(){ let m = require("fs"); m = 5; let z = m; }\n', 'z')).toContain('integer');
});

// ── Soundness: only literal known builtin modules ────────────────────────────
test('09 require("notamodule") (unknown) is NOT a module type', async () => {
  expect(await typeOf('function f(){ let o={}; o.x = require("notamodule"); let a = o.x; }\n', 'a')).not.toMatch(/module/);
});
test('10 require(variable) (non-literal arg) is not resolved to a module', async () => {
  const t = await typeOf('function f(name){ let o={}; o.x = require(name); let a = o.x; }\n', 'a');
  expect(t).not.toMatch(/module/);
});
test('11 require() arg validation still fires (zero args)', async () => {
  // Zero-arg require() returns null (valid-but-useless): a strict-gated useless-call diagnostic
  // (error under 'use strict'). Assert the strict error so this stays an error-level check.
  expect((await errs("'use strict';\nfunction f(){ let x = require(); }\n")).some((e) => /require\(\)/.test(e.message))).toBe(true);
});

// ── File-path require is intentionally NOT builtin-typed (TODO) ───────────────
test('12 require("./file.uc") is not treated as a builtin module type', async () => {
  // (no crash; file-path require typing is a documented follow-up)
  const t = await typeOf('function f(){ let m = require("./other.uc"); let a = m; }\n', 'a');
  expect(t).not.toMatch(/\bfs module\b|\bmath module\b/);
});
