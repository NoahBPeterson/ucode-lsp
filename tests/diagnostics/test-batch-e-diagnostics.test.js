// Batch E diagnostic regressions (ucode C source cited per case):
//  - 119: string indexing `s[0]` raises a runtime error (vm.c uc_vm_insn_load_val default
//    case) — flag it; it is NOT a substring/char-code.
//  - 78: strict `===`/`!==` between distinct scalar base types is always false
//    (vm.c uc_vm_test_strict_equality bails on `t1 != t2`); `==`/`!=` coerce → not flagged.
//  - 145: reading an unknown property on a resource handle (fs.proc) returns null → a
//    "Property … returns null" warning, not a hard "Method … does not exist" error;
//    a CALL of an unknown member stays a hard error.
//  - 140: reassigning a guarded var to null inside the guard drops the stale non-null guard.
//  - 143: `length(x || []) > 0` in strict mode is not flagged (length is total, test context).
//  - 138: constant-index element narrowing works outside call-argument position.
//  - loop: `while (length(a) > 0) { a[0] }` narrows the index in-bounds (with a mutation gate).
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getDiagnostics;
let n = 0;
const fp = () => `/tmp/batchE-diag-${n++}.uc`;
const diags = async (code) => (await getDiagnostics(code, fp())) || [];

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('119: string indexing is flagged', () => {
  test('s[0] on a string is an error', async () => {
    const d = await diags('let s = "abc";\nlet c = s[0];\nprint(c);\n');
    const hit = d.filter((x) => /Strings cannot be indexed/.test(x.message));
    expect(hit.length).toBe(1);
    expect(hit[0].severity).toBe(1); // Error
  });
});

describe('78: strict scalar-mismatch equality is flagged (=== only)', () => {
  test('5 === "5", true === 1, 5 === 5.0 all flagged; 5 === 5 and 5 == "5" not', async () => {
    const d = await diags('print(5 === "5");\nprint(true === 1);\nprint(5 === 5.0);\nprint(5 === 5);\nprint(5 == "5");\n');
    const impossible = d.filter((x) => x.code === 'UC2009' && /always false/.test(x.message));
    expect(impossible.length).toBe(3);
  });
  test('== / != scalar mismatch is NOT flagged (coerces)', async () => {
    const d = await diags('print(5 == "5");\nprint(1 != "x");\n');
    expect(d.filter((x) => x.code === 'UC2009').length).toBe(0);
  });
});

describe('145: property read vs method call on fs.proc', () => {
  test('property read → "Property" wording, not "Method"', async () => {
    const d = await diags("import{popen}from'fs';\nlet p=popen('cmd');\nlet x=p.OS;\nprint(x);\n");
    const prop = d.filter((x) => /Property 'OS' does not exist/.test(x.message));
    expect(prop.length).toBe(1);
    expect(d.filter((x) => /Method 'OS' does not exist/.test(x.message)).length).toBe(0);
  });
  test('method call → Method error', async () => {
    const d = await diags("import{popen}from'fs';\nlet p=popen('cmd');\np.OS();\n");
    expect(d.filter((x) => /Method 'OS' does not exist/.test(x.message)).length).toBe(1);
  });
});

describe('140: reassign-to-null inside a guard is flagged', () => {
  test('if (x) { x = null; substr(x) } flags null arg', async () => {
    const d = await diags("import { readfile } from 'fs';\nlet x = readfile('/a');\nif (x) { x = null; substr(x, 0, 2); }\n");
    expect(d.filter((x) => x.code === 'UC2004' || /got null/.test(x.message)).length).toBeGreaterThan(0);
  });
  test('if (x) { substr(x) } without reassignment stays clean', async () => {
    const d = await diags("import { readfile } from 'fs';\nlet x = readfile('/a');\nif (x) { substr(x, 0, 2); }\n");
    expect(d.filter((x) => /substr/.test(x.message)).length).toBe(0);
  });
});

describe('143: length(x || []) > 0 in strict mode is not flagged', () => {
  // Ticket's verified repro (function defined, not called): the length arg union
  // `array | unknown` reads correctly in the `> 0` test context.
  test('no nullable/unknown-argument diagnostic on length', async () => {
    const d = await diags("'use strict';\nfunction f(x) { return length(x || []) > 0; }\n");
    expect(d.filter((x) => /length\(\)/.test(x.message)).length).toBe(0);
  });
});

describe('138: constant-index narrowing outside call-argument position', () => {
  test('if (a[0]) { let y = a[0]; substr(y) } is clean', async () => {
    const d = await diags("import { readfile } from 'fs';\nlet a=[readfile('/a')];\nif (a[0]) { let y = a[0]; substr(y,0,2); }\n");
    expect(d.filter((x) => /substr/.test(x.message)).length).toBe(0);
  });
});

describe('loop: while/for guard narrows array index in-bounds', () => {
  test('while (length(ARGV) > 0) { ARGV[0] } is clean (mutation after access)', async () => {
    const d = await diags('while (length(ARGV) > 0) { let cmd = ARGV[0]; substr(cmd, 1); shift(ARGV); }\n');
    expect(d.filter((x) => /nullable-argument/.test(x.code || '')).length).toBe(0);
  });
});
