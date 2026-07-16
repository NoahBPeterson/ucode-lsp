// Module call arguments are validated against the registry signatures.
// docs/tc-inferred-param-types-not-checked.md (Part 2 — TypeChecker.checkModuleArgumentTypes)
//
// The module registries (fs, ubus, uci, uloop, socket, …) declare parameter types that
// nothing on the diagnostic path ever read — 199 functions, 176 with parameters, zero
// argument checks. Now validated, conservatively: WARNINGS only (a wrong-typed arg to a
// module C function `err_return(EINVAL)`s → returns null, it does not throw), unknown
// actuals skipped, and parameters with no checkable contract (`any`, handle types) skipped.
//
// NOTE: this suite is intentionally independent of call-site parameter inference (B3),
// which was removed pending re-review. Unions are synthesized with `flag ? A : B`
// ternaries (a non-constant condition) rather than inferred from call sites. When B3
// returns, the composed "inferred union into a module param" cases move back into their
// own suite.
//
// Driven through the real LSP server.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function diags(code) {
  const uri = `file:///tmp/tc-modarg-${++n}.uc`;
  return await server.getDiagnostics(code, uri);
}

/** Diagnostics that argument-type validation owns. */
const ARG_CODES = new Set(['incompatible-function-argument', 'nullable-argument', 'UC2004', 'UC2007']);
const argDiags = ds => ds.filter(d => ARG_CODES.has(String(d.code)));
const messages = ds => argDiags(ds).map(d => d.message).join('\n');

// ---------------------------------------------------------------------------
// Core: a declared module parameter type is now checked
// ---------------------------------------------------------------------------

test('module call: literal of the wrong type is a definite mismatch', async () => {
  const ds = await diags(`import * as fs from 'fs';\nfs.popen(1, 'r');\n`);
  const m = messages(ds);
  expect(m).toContain("Function 'fs.popen' expects string for argument 1");
  expect(m).toContain('it will return null');
});

test('module call: a wrong-typed argument is a WARNING, never an error', async () => {
  // ucode/lib/fs.c uc_fs_popen: `if (ucv_type(comm) != UC_STRING) err_return(EINVAL);`
  // → returns null, does not throw. So this is not an error-severity defect.
  const ds = await diags(`import * as fs from 'fs';\nfs.popen(1, 'r');\n`);
  const errs = argDiags(ds).filter(d => d.severity === 1); // 1 = Error
  expect(errs).toEqual([]);
  expect(argDiags(ds).length).toBeGreaterThan(0);
});

test('module call: correct argument type is silent', async () => {
  const ds = await diags(`import * as fs from 'fs';\nfs.popen("cmd", 'r');\n`);
  expect(argDiags(ds)).toEqual([]);
});

test('module call: an unknown-typed actual argument is skipped (no nagging)', async () => {
  const ds = await diags(`import * as fs from 'fs';\nfunction f(u) { return fs.popen(u, 'r'); }\nlet esc = f;\n`);
  expect(argDiags(ds)).toEqual([]);
});

test('module call: an `any`-contract parameter is never checked', async () => {
  const ds = await diags(`import * as ubus from 'ubus';\nlet c = ubus.connect();\n`);
  expect(argDiags(ds)).toEqual([]);
});

test('module call: named-import form is validated', async () => {
  const ds = await diags(`import { popen } from 'fs';\npopen(1, 'r');\n`);
  expect(messages(ds)).toContain("Function 'fs.popen' expects string for argument 1");
});

test('module call: chained require() form is validated', async () => {
  const ds = await diags(`require('fs').popen(1, 'r');\n`);
  expect(messages(ds)).toContain("Function 'fs.popen' expects string for argument 1");
});

test('module call: optional parameter accepts null', async () => {
  const ds = await diags(`import * as fs from 'fs';\nfs.popen("cmd", null);\n`);
  expect(argDiags(ds)).toEqual([]);
});

test('module call: a genuine union mismatch fires a partial (may-be) warning', async () => {
  // A real uci list option yields an array; fs.access(array) returns null. Synthesized
  // here with a ternary union (string | array) so the test does not depend on B3.
  const code = `import * as fs from 'fs';\nfunction demo(flag) {\n  let p = flag ? "x" : ["a"];\n  return fs.access(p);\n}\n`;
  expect(messages(await diags(code))).toContain('may be array');
});

test('module call: a guard rescues a union argument', async () => {
  const code = `import * as fs from 'fs';\nfunction demo(flag) {\n  let p = flag ? "x" : ["a"];\n  if (type(p) == "string") return fs.popen(p, 'r');\n  return null;\n}\n`;
  expect(argDiags(await diags(code))).toEqual([]);
});

// ---------------------------------------------------------------------------
// The soundness gates the corpus run forced. Each one was a real false positive.
// ---------------------------------------------------------------------------

test('gate: `ubus` is excluded (its C uses args_get_named)', async () => {
  // ucode/lib/ubus.c uc_ubus_call: `args_get_named(vm, nargs, "object", 0, REQUIRED, …)`.
  // Type code 0 = no constraint, and every ubus function accepts a single named-args
  // OBJECT instead of positional args. wifi-scripts/wireless.uc does exactly that.
  const ds = await diags(`import * as ubus from 'ubus';\nubus.call({ object: "network", method: "status" });\n`);
  expect(argDiags(ds)).toEqual([]);
});

test('gate: integer and double are interchangeable at numeric params', async () => {
  // ucode/lib/uloop.c uc_uloop_timer: `t = ucv_int64_get(timeout)` coerces a double.
  // A literal double and a synthetic integer|double union both stay silent.
  expect(argDiags(await diags(`import * as uloop from 'uloop';\nuloop.timer(1500.0, function() {});\n`))).toEqual([]);
  const union = `import * as uloop from 'uloop';\nfunction demo(flag) {\n  let ms = flag ? 1 : 1.5;\n  uloop.timer(ms, function() {});\n}\n`;
  expect(argDiags(await diags(union))).toEqual([]);
});

test('gate: a null actual is not a module-argument mismatch', async () => {
  // The forward-declaration idiom: `let cb;` … used inside a body … `cb = fn;` later.
  // Its SSA type at the read is `null`, but the value at call time is a function
  // (mwan4track.uc). Flagging it reproduces docs/forward-let-fn-uc1002.md one layer down.
  const code = `import * as uloop from 'uloop';\nlet cb;\nfunction schedule(ms) { uloop.timer(ms, cb); }\ncb = function() {};\nschedule(1);\n`;
  expect(argDiags(await diags(code))).toEqual([]);
});

test('gate: socket.addrinfo accepts a numeric service (registry said string; C says any)', async () => {
  // ucode/lib/socket.c uc_socket_addrinfo declares `"service", UC_NULL, true, &serv`
  // — UC_NULL = no type constraint. `socket.addrinfo(host, 443)` is valid.
  const ds = await diags(`import * as socket from 'socket';\nsocket.addrinfo("example.org", 443);\n`);
  expect(argDiags(ds)).toEqual([]);
});
