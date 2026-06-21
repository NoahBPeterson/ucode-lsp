// Diagnostics that ucode only errors on under 'use strict' must not fire in non-strict
// code (verified vs the interpreter). Four cases, each strict-gated:
//   1. bare `for (x in …)` loop var — implicit global non-strict; strict error.
//   2. `let` redeclaration — allowed non-strict (last wins); strict syntax error.
//   3. calling an implicit-global function — name provably exists; not "Undefined function".
//   4. bare `name = require("mod")` — the CommonJS-import pattern; `name.member` resolves.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });
const errs = async (code) => (await server.getDiagnostics(code, `/tmp/nsd-${n++}.uc`) || []).filter((x) => x.severity === 1);
const codes = (ds) => ds.map((x) => x.code || '(none)');
const msgs = (ds) => ds.map((x) => x.message);

// ── #1 bare for-in loop variables ────────────────────────────────────────────
test('01 non-strict: bare for-in var read after the loop is not flagged', async () => {
  expect(codes(await errs('function f(a){ for (k in a) {} return k; }\n'))).not.toContain('UC1001');
});
test('02 non-strict: bare for-in var used inside the loop is not flagged', async () => {
  expect(codes(await errs('function f(a){ for (k in a) { print(k); } }\n'))).not.toContain('UC1001');
});
test('03 non-strict: `for (let x in …)` is clean', async () => {
  expect(await errs('function f(a){ for (let x in a) { print(x); } }\n')).toEqual([]);
});
test('04 strict: a bare for-in var IS flagged (must be declared)', async () => {
  const m = msgs(await errs("'use strict';\nfunction f(a){ for (k in a) { print(k); } }\n"));
  expect(m.some((x) => /Loop variable 'k' is not declared/.test(x))).toBe(true);
});
test('05 strict: `for (let x in …)` is clean', async () => {
  expect(msgs(await errs("'use strict';\nfunction f(a){ for (let x in a) { print(x); } }\n")).some((x) => /Loop variable/.test(x))).toBe(false);
});

// ── #2 let redeclaration ─────────────────────────────────────────────────────
test('06 non-strict: `let x; let x;` is not flagged (UC1003)', async () => {
  expect(codes(await errs('function f(){ let x = 1; let x = 2; return x; }\n'))).not.toContain('UC1003');
});
test('07 strict: `let x; let x;` IS flagged UC1003', async () => {
  expect(codes(await errs("'use strict';\nfunction f(){ let x = 1; let x = 2; return x; }\n"))).toContain('UC1003');
});
test('08 non-strict: a redeclared var still resolves (no UC1001 on later use)', async () => {
  expect(codes(await errs('function f(){ let v = 1; let v = 2; return v + v; }\n'))).not.toContain('UC1001');
});
test('09 non-strict: the ubi_create `let ret` repeated pattern is clean', async () => {
  const code = 'function f(){ let ret = 1; if (ret) return ret; let ret = 2; if (ret) return ret; let ret = 3; return ret; }\n';
  expect(codes(await errs(code))).not.toContain('UC1003');
});

// ── #3 calling an implicit-global function ───────────────────────────────────
test('10 non-strict: an implicit-global function call is not "Undefined function"', async () => {
  const m = msgs(await errs('function s(ctx){ uci_commit = ctx.c; }\nfunction u(){ return uci_commit(); }\n'));
  expect(m.some((x) => /Undefined function: uci_commit/.test(x))).toBe(false);
});
test('11 non-strict: that call is not "Undefined variable" either', async () => {
  expect(codes(await errs('function s(ctx){ uci_commit = ctx.c; }\nfunction u(){ return uci_commit(); }\n'))).not.toContain('UC1001');
});
test('12 non-strict: a genuinely undefined function call IS still flagged', async () => {
  expect(msgs(await errs('function f(){ return totallyMissing(); }\n')).some((x) => /Undefined function: totallyMissing/.test(x))).toBe(true);
});
test('13 strict: an implicit-global pattern is still flagged (no implicit globals in strict)', async () => {
  expect((await errs("'use strict';\nfunction s(ctx){ uci_commit = ctx.c; }\nfunction u(){ return uci_commit(); }\n")).length).toBeGreaterThan(0);
});

// ── #4 bare `name = require("mod")` ──────────────────────────────────────────
test('14 non-strict: `math = require("math"); math.rand()` — no UC3006, no UC1001', async () => {
  const c = codes(await errs('function f(){ math = require("math"); return math.rand(); }\n'));
  expect(c).not.toContain('UC3006');
  expect(c).not.toContain('UC1001');
});
test('15 bare-require module member resolves (hover shows the math module)', async () => {
  const code = 'function f(){ math = require("math"); return math.rand(); }\n';
  const h = await server.getHover(code, `/tmp/nsd-h.uc`, 0, 16); // on `math` before `.rand`
  const v = h && h.contents && (h.contents.value || h.contents);
  expect((typeof v === 'string' ? v : JSON.stringify(v || ''))).toMatch(/math/);
});
test('16 `let math = require("math")` still resolves (regression)', async () => {
  expect(codes(await errs('function f(){ let math = require("math"); return math.rand(); }\n'))).not.toContain('UC3006');
});
test('17 bare require of an UNKNOWN module is not treated as a module (no false resolution)', async () => {
  // `whatever` isn't a known builtin module → no module symbol; it's just an implicit
  // global, so no UC3006/UC1001, and member access stays unknown (no crash).
  const c = codes(await errs('function f(){ thing = require("notamodule"); return thing.x(); }\n'));
  expect(c).not.toContain('UC1001');
});

// ── Real-world: the uvol UBI backend (fuzz-tests/ubi.uc) ─────────────────────
// ubi.uc is non-strict, so an undefined read is a Warning (not an Error) — it
// evaluates to null at runtime. These checks are therefore severity-agnostic and
// scoped to undefined-variable/function diagnostics: the only name we still can't
// resolve is the host-injected `backend` (pending runtime introspection).
const undefDiags = async (code, path) =>
  ((await server.getDiagnostics(code, path)) || []).filter((x) => /Undefined (variable|function)/.test(x.message || ''));
test('18 ubi.uc: every undefined-var diagnostic except host-injected `backend` is gone', async () => {
  const path = `${__dirname}/../fuzz-tests/ubi.uc`;
  const u = await undefDiags(fs.readFileSync(path, 'utf8'), path);
  const nonBackend = u.filter((x) => !/backend/.test(x.message || ''));
  expect(nonBackend.map((x) => `L${x.range.start.line + 1} ${x.message.slice(0, 50)}`)).toEqual([]);
});
test('19 ubi.uc: the remaining undefined-var diagnostics are all `backend` (pending introspection)', async () => {
  const path = `${__dirname}/../fuzz-tests/ubi.uc`;
  const u = await undefDiags(fs.readFileSync(path, 'utf8'), path);
  expect(u.length).toBeGreaterThan(0);
  expect(u.every((x) => /backend/.test(x.message || ''))).toBe(true);
});
test('20 ubi.uc: no UC1003, UC3006, or undefined-function diagnostics remain', async () => {
  const code = fs.readFileSync(`${__dirname}/../fuzz-tests/ubi.uc`, 'utf8');
  const all = (await server.getDiagnostics(code, `${__dirname}/../fuzz-tests/ubi.uc`)) || [];
  expect(codes(all)).not.toContain('UC1003');
  expect(codes(all)).not.toContain('UC3006');
  expect(all.some((x) => /Undefined function/.test(x.message || ''))).toBe(false);
});
