// `ucode -D NAME=<json>` injects a global (any JSON type; unparseable text becomes a string)
// before the script runs. A source-only read of such a SCREAMING_SNAKE name is flagged UC1001,
// tiered by how safe the usage is (interpreter-verified semantics):
//   - non-strict + the read IS a bare truthiness test (if (X), X ?? d, !X, X || d): HINT —
//     an uninjected read is null, so the test doubles as the runtime existence check.
//   - non-strict, unguarded value use: WARNING + advice to add a runtime check.
//   - strict mode: WARNING always — a bare read RAISES "access to undeclared variable" when
//     not injected (even inside if (X)); only global.X or a @global declaration is safe.
// See docs/done/cli-defined-globals.md (Option 5, revised per user review 2026-07-07).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, dir;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snakeglob-'));
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

async function diags(code) {
  const file = path.join(dir, `s-${Math.random().toString(36).slice(2)}.uc`);
  return (await server.getDiagnostics(code, file)) || [];
}
const find = (ds, name) => ds.find(d => d.code === 'UC1001' && d.message.includes(name));
const HINT = 4, WARNING = 2;

test('guarded read is a HINT; unguarded value use is a WARNING (non-strict)', async () => {
  const ds = await diags('let t = TYPE;\nif (QUIET) exit(1);\n');
  const type = find(ds, 'TYPE'), quiet = find(ds, 'QUIET');
  expect(type && type.severity).toBe(WARNING);          // value use — needs a runtime check
  expect(type.message).toContain('runtime check');
  expect(quiet && quiet.severity).toBe(HINT);           // if (QUIET) IS the runtime check
  expect(quiet.message).toContain('runtime-guarded');
});

test('?? default and !X guards are HINTs; strict mode is always a WARNING', async () => {
  const ns = await diags('let lvl = VERBOSITY ?? 1;\nif (!DISABLED) print(1);\n');
  expect(find(ns, 'VERBOSITY')?.severity).toBe(HINT);
  expect(find(ns, 'DISABLED')?.severity).toBe(HINT);
  const strict = await diags('"use strict";\nif (QUIET) print(1);\n');
  const q = find(strict, 'QUIET');
  expect(q && q.severity).toBe(WARNING);                // bare read raises in strict
  expect(q.message).toContain('global.QUIET');
});

test('lowercase undefined name stays a warning', async () => {
  const ds = await diags('let a = lowercase_undef;\n');
  const d = find(ds, 'lowercase_undef');
  expect(d && d.severity).toBe(WARNING);
});

test('a SCREAMING_SNAKE name assigned elsewhere in the file is NOT downgraded', async () => {
  // SCOPED is let-declared inside a function; the top-level read is out of scope. Because the
  // name IS declared somewhere, it reads as a scope bug (warning), not an injected global.
  const ds = await diags('function f() { let SCOPED = 1; return SCOPED; }\nlet x = SCOPED;\n');
  const d = find(ds, 'SCOPED');
  expect(d && d.severity).toBe(WARNING);
});

test('single-letter all-caps is NOT treated as an injected global', async () => {
  const ds = await diags('let x = Q;\n');
  const d = find(ds, 'Q');
  expect(d && d.severity).toBe(WARNING);
});

test('multi-word SCREAMING_SNAKE with digits gets the injected-global message', async () => {
  const ds = await diags('let x = MAX_LEN_2;\n');
  const d = find(ds, 'MAX_LEN_2');
  expect(d && d.severity).toBe(WARNING);                // unguarded value use
  expect(d.message).toContain('host/CLI-injected');
});
