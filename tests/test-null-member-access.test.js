// Accessing a member of a provably-null value is a hard ucode RUNTIME error (verified vs
// /usr/local/bin/ucode):
//   let x; x.foo   -> "Reference error: left-hand side expression is null"
//   let x; x[0]    -> "Reference error: left-hand side expression is null"
//   let x; x.foo() -> "Reference error: left-hand side expression is null"
// Optional chaining short-circuits to null and is the sanctioned safe form:
//   let x; x?.foo  -> (no error)
// The LSP previously reported nothing. Now (Tier 1) it flags non-optional member/index/call
// when the receiver is EXACTLY null. A `T | null` union ("possibly null") is deliberately
// NOT flagged here (Tier 2). Flow narrowing is honored: a truthy guard `if (x)` (which makes
// the body unreachable for a provably-null x) and a reassignment to a non-null value both
// suppress it. Unlocked by 0.6.204 (uninitialized `let` is now typed null).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/null-access-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const flagged = async (code) => (await errs(code)).some((m) => /null value/.test(m));

// ── Flagged: provably-null receiver, non-optional access ─────────────────────
test('uninitialized var property read is flagged', async () => {
  expect(await flagged('let x;\nlet y = x.foo;\n')).toBe(true);
});
test('uninitialized var index is flagged', async () => {
  expect(await flagged('let x;\nlet y = x[0];\n')).toBe(true);
});
test('uninitialized var method call is flagged', async () => {
  expect(await flagged('let x;\nx.foo();\n')).toBe(true);
});
test('let x = null; x.bar is flagged', async () => {
  expect(await flagged('let x = null;\nlet y = x.bar;\n')).toBe(true);
});
test('the message names the property and suggests optional chaining', async () => {
  const m = await errs('let cfg;\nlet y = cfg.port;\n');
  expect(m.some((x) => /property 'port'/.test(x))).toBe(true);
  expect(m.some((x) => /optional chaining|\?\./.test(x))).toBe(true);
});
test('the message names the null identifier', async () => {
  expect((await errs('let cfg;\ncfg.port;\n')).some((m) => /'cfg' is null/.test(m))).toBe(true);
});

// ── Property WRITES on null (ucode: "attempt to set property on null value") ─
test('writing a property of a null var is flagged', async () => {
  expect(await flagged('let x;\nx.foo = 1;\n')).toBe(true);
});
test('writing an element of a null var is flagged', async () => {
  expect(await flagged('let x;\nx[0] = 1;\n')).toBe(true);
});
test('a property write uses the "set property" message (not "access"/optional-chaining)', async () => {
  const m = await errs('let x;\nx.foo = 1;\n');
  expect(m.some((x) => /set property 'foo' on a null value/.test(x))).toBe(true);
  // optional chaining is not valid on an assignment LHS — must not be suggested
  expect(m.some((x) => /optional chaining/.test(x))).toBe(false);
});
test('a READ still uses the "access property" + optional-chaining message', async () => {
  const m = await errs('let x;\nlet y = x.foo;\n');
  expect(m.some((x) => /access property 'foo' of a null value/.test(x))).toBe(true);
  expect(m.some((x) => /optional chaining/.test(x))).toBe(true);
});
test('a property write after reassignment to null is flagged', async () => {
  expect(await flagged('let x = { a: 1 };\nx = null;\nx.a = 9;\n')).toBe(true);
});
test('a property write guarded by `if (x)` is clean', async () => {
  expect(await flagged('let x;\nif (x) {\n  x.foo = 1;\n}\n')).toBe(false);
});

// ── Not flagged: optional chaining (the sanctioned safe form) ────────────────
test('optional chaining x?.foo is NOT flagged', async () => {
  expect(await flagged('let x;\nlet y = x?.foo;\n')).toBe(false);
});
test('optional index x?.[0] is NOT flagged', async () => {
  expect(await flagged('let x;\nlet y = x?.[0];\n')).toBe(false);
});

// ── Not flagged: flow narrowing (guards / reassignment) ──────────────────────
test('a truthy guard `if (x)` suppresses it (body is unreachable for a null x)', async () => {
  expect(await flagged('let x;\nif (x) {\n  let y = x.foo;\n}\n')).toBe(false);
});
test('an `if (x != null)` guard suppresses it', async () => {
  expect(await flagged('let x;\nif (x != null) {\n  let y = x.foo;\n}\n')).toBe(false);
});
test('reassignment to an object before access suppresses it', async () => {
  expect(await flagged('let x;\nx = { foo: 1 };\nlet y = x.foo;\n')).toBe(false);
});

// ── Reassignment TO null is caught (most-recent SSA type wins) ───────────────
test('reassigning an object to null then accessing it IS flagged (stale shape ignored)', async () => {
  // `let x = {a:1}; x = null; x.a` — x is null here despite the dead {a:1} property shape
  expect(await flagged('let x = { a: 1 };\nx = null;\nlet y = x.a;\n')).toBe(true);
});
test('reassigning any value to null then accessing it is flagged', async () => {
  expect(await flagged('let x = 5;\nx = null;\nlet y = x.foo;\n')).toBe(true);
});
test('reassigned-to-null then guarded by `if (x)` is suppressed', async () => {
  expect(await flagged('let x = { a: 1 };\nx = null;\nif (x) {\n  let y = x.a;\n}\n')).toBe(false);
});
test('a stale object shape is NOT used after reassignment to null (no false property type)', async () => {
  // Before the SSA fix, `x.a` returned the dead {a:1} integer shape and skipped the check.
  expect(await flagged('let x = { a: 1 };\nx = null;\nx.a;\n')).toBe(true);
});

// ── Not flagged: non-null / unknown / union receivers ────────────────────────
test('an object variable is not flagged', async () => {
  expect(await flagged('let o = { a: 1 };\nlet y = o.a;\n')).toBe(false);
});
test('a function parameter (unknown) is not flagged', async () => {
  expect(await flagged('function f(p) {\n  return p.foo;\n}\n')).toBe(false);
});
test('a nullable union receiver (Tier 2) is NOT flagged by Tier 1', async () => {
  // sort(keys(...)) is array | null — "possibly null", not "provably null"
  expect((await errs('let arr = sort(keys({a:1}));\nlet n = arr[0];\n')).some((m) => /null value/.test(m))).toBe(false);
});

// ── Tier 2: possibly-null (T | null) member access → WARNING ─────────────────
const warns = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 2).map((x) => x.message);
const warnedNull = async (code) => (await warns(code)).some((m) => /may be null/.test(m));

test('object|null (from a ternary) accessed unguarded warns', async () => {
  expect(await warnedNull('let o = { a: 1 };\nlet x = (1 > 0) ? o : null;\nx.a;\n')).toBe(true);
});
test('the possibly-null diagnostic is a WARNING, not an error', async () => {
  const code = 'let o = { a: 1 };\nlet x = (1 > 0) ? o : null;\nx.a;\n';
  const d = await server.getDiagnostics(code, uri());
  expect(d.some((x) => x.severity === 2 && /may be null/.test(x.message))).toBe(true);
  expect(d.some((x) => x.severity === 1 && /may be null/.test(x.message))).toBe(false);
});
test('a nullable uci cursor() handle (direct chain) warns', async () => {
  expect(await warnedNull('import { cursor } from "uci";\ncursor().foreach("a", "b", (s) => {});\n')).toBe(true);
});
test('a STORED nullable cursor handle used unguarded warns', async () => {
  expect(await warnedNull('import { cursor } from "uci";\nlet c = cursor();\nc.foreach("a", "b", (s) => {});\n')).toBe(true);
});
test('a nullable fs.open() handle used unguarded warns', async () => {
  expect(await warnedNull('import { open } from "fs";\nlet f = open("/x");\nf.read(64);\n')).toBe(true);
});
test('a guarded nullable handle does NOT warn', async () => {
  expect(await warnedNull('import { open } from "fs";\nlet f = open("/x");\nif (f) { f.read(64); }\n')).toBe(false);
});
test('an early-return-guarded nullable handle does NOT warn', async () => {
  expect(await warnedNull('import { open } from "fs";\nlet f = open("/x");\nif (!f) return;\nf.read(64);\n')).toBe(false);
});
test('optional chaining on a nullable handle does NOT warn', async () => {
  expect(await warnedNull('import { open } from "fs";\nlet f = open("/x");\nf?.read(64);\n')).toBe(false);
});
test('a plain (non-nullable) object does NOT warn', async () => {
  expect(await warnedNull('let o = { a: 1 };\no.a;\n')).toBe(false);
});
test('a scalar|null receiver is left to its own error (no Tier 2 warning)', async () => {
  expect(await warnedNull('let x = (1 > 0) ? 5 : null;\nx.foo;\n')).toBe(false);
});

// ── Under `'use strict'`, Tier 2 escalates from warning to error ─────────────
const sevOfNull = async (code) => {
  const d = (await server.getDiagnostics(code, uri()) || []).filter((x) => /may be null/.test(x.message));
  return d.map((x) => x.severity); // 1 = error, 2 = warning
};
test('non-strict: possibly-null is a WARNING (severity 2)', async () => {
  expect(await sevOfNull('import { open } from "fs";\nlet f = open("/x");\nf.read(64);\n')).toEqual([2]);
});
test("'use strict': possibly-null escalates to an ERROR (severity 1)", async () => {
  expect(await sevOfNull('\'use strict\';\nimport { open } from "fs";\nlet f = open("/x");\nf.read(64);\n')).toEqual([1]);
});
test("'use strict': a guarded nullable handle is still clean (no escalation when narrowed)", async () => {
  expect(await sevOfNull('\'use strict\';\nimport { open } from "fs";\nlet f = open("/x");\nif (f) { f.read(64); }\n')).toEqual([]);
});
test("'use strict': cursor().foreach escalates to error", async () => {
  expect(await sevOfNull('\'use strict\';\nimport { cursor } from "uci";\ncursor().foreach("a", "b", (s) => {});\n')).toEqual([1]);
});

// ── Does not disturb the existing primitive-access diagnostics ───────────────
test('regression: array property access still gets its own (array) error, not the null one', async () => {
  const m = await errs('let a = [1, 2];\nlet y = a.length;\n');
  expect(m.some((x) => /does not exist on array type/.test(x))).toBe(true);
  expect(m.some((x) => /null value/.test(x))).toBe(false);
});
test('regression: string property access still gets its own (string) error', async () => {
  const m = await errs('let s = "hi";\nlet y = s.length;\n');
  expect(m.some((x) => /does not exist on string type/.test(x))).toBe(true);
  expect(m.some((x) => /null value/.test(x))).toBe(false);
});
