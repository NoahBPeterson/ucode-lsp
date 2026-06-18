// Diagnostic coverage for the builtin arity/coercion hardening:
//   #146 — zero-arg builtins are valid in ucode (return null/"") but useless -> UC2012 warning
//   #31  — splice's real minimum arity is 1 (splice(arr) clears the array); splice(5) on a
//          non-array is an error; splice() is the zero-arg useless-call warning
//   #144 — sleep coerces its argument to a number: numeric strings are fine, a non-numeric
//          string / array is a footgun (warn, or error under 'use strict'), and a union whose
//          every member is numeric is clean (per-member check)
//
// All behaviors verified against the ucode interpreter / lib.c. See docs/done for the writeups.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, getDiagnostics;
let n = 0;
const fp = () => `/tmp/arity-${n++}.uc`;

// diagnostics carrying the given UC code
async function diagsFor(code, ucCode) {
  const d = (await getDiagnostics(code, fp())) || [];
  return d.filter((x) => x.code === ucCode);
}
// every UC2004/UC2012 diagnostic (the codes this suite cares about)
async function relevant(code) {
  const d = (await getDiagnostics(code, fp())) || [];
  return d.filter((x) => x.code === 'UC2004' || x.code === 'UC2012');
}
const SEV = { ERROR: 1, WARNING: 2 };

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('#146 — zero-arg builtins warn UC2012 (useless call)', () => {
  const ZERO_ARG = [
    ['min', 'returns null'],
    ['max', 'returns null'],
    ['ord', 'returns null'],
    ['type', 'returns null'],
    ['chr', 'returns an empty string'],
    ['uchr', 'returns an empty string'],
    ['printf', 'produces no output'],
    ['sprintf', 'returns an empty string'],
    ['splice', 'returns null and modifies nothing'],
  ];

  for (const [fn, effect] of ZERO_ARG) {
    test(`${fn}() -> one UC2012 warning, "${effect}"`, async () => {
      const w = await diagsFor(`${fn}();\n`, 'UC2012');
      expect(w.length).toBe(1);
      expect(w[0].severity).toBe(SEV.WARNING);
      expect(w[0].message).toBe(`${fn}() with no arguments has no effect (it ${effect}).`);
    });
  }

  // A useless call is valid ucode — it must stay a WARNING even under 'use strict', never an error.
  test('UC2012 stays a warning under \'use strict\'', async () => {
    for (const [fn] of ZERO_ARG) {
      const w = await diagsFor(`'use strict';\n${fn}();\n`, 'UC2012');
      expect(w.length).toBe(1);
      expect(w[0].severity).toBe(SEV.WARNING);
    }
  });

  // With real arguments these are all clean — no false useless-call warning.
  test('non-zero-arg forms produce no UC2012', async () => {
    for (const call of ['min(3, 1, 2)', 'max(1, 2)', 'ord("A")', 'type(1)', 'chr(65)', 'uchr(65)']) {
      expect((await diagsFor(`${call};\n`, 'UC2012')).length).toBe(0);
    }
  });
});

describe('#31 — splice arity (minimum is 1, not 2)', () => {
  const arr = 'let a = [1, 2, 3];\n';

  test('splice(arr) — 1-arg form clears the array — is clean', async () => {
    expect((await relevant(`${arr}splice(a);\n`)).length).toBe(0);
  });
  test('splice(arr, 1) — 2-arg — is clean', async () => {
    expect((await relevant(`${arr}splice(a, 1);\n`)).length).toBe(0);
  });
  test('splice(arr, 1, 1) — 3-arg — is clean', async () => {
    expect((await relevant(`${arr}splice(a, 1, 1);\n`)).length).toBe(0);
  });
  test('splice() — zero-arg — is the UC2012 useless-call warning, not an arity error', async () => {
    const r = await relevant('splice();\n');
    expect(r.length).toBe(1);
    expect(r[0].code).toBe('UC2012');
    expect(r[0].severity).toBe(SEV.WARNING);
  });
  test('splice(5) — non-array first arg — is a UC2004 error in both modes', async () => {
    for (const prefix of ['', `'use strict';\n`]) {
      const e = await diagsFor(`${prefix}splice(5);\n`, 'UC2004');
      expect(e.length).toBe(1);
      expect(e[0].severity).toBe(SEV.ERROR);
      expect(e[0].message).toContain("expects array for argument 1");
    }
  });
});

describe('#144 — sleep coerces its argument to a number', () => {
  test('numeric arguments are clean (integer, double, numeric string)', async () => {
    for (const call of ['sleep(250)', 'sleep(10.5)', 'sleep("250")']) {
      expect((await relevant(`${call};\n`)).length).toBe(0);
    }
  });

  test('non-numeric string is a footgun: warn non-strict, error under strict', async () => {
    const warn = await diagsFor('sleep("soon");\n', 'UC2004');
    expect(warn.length).toBe(1);
    expect(warn[0].severity).toBe(SEV.WARNING);
    expect(warn[0].message).toContain('cannot be converted to a number');

    const err = await diagsFor(`'use strict';\nsleep("soon");\n`, 'UC2004');
    expect(err.length).toBe(1);
    expect(err[0].severity).toBe(SEV.ERROR);
  });

  test('array argument coerces to 0 ms — a footgun warning', async () => {
    const w = await diagsFor('sleep([1]);\n', 'UC2004');
    expect(w.length).toBe(1);
    expect(w[0].severity).toBe(SEV.WARNING);
  });

  test('a union whose every member is numeric is clean (per-member check)', async () => {
    // clock()[0] * 1000 + 0.5 is inferred as `unknown | double`; every member is numeric,
    // so the coercion check must NOT fire (this was a false error before #144).
    const code = 'function pace() {\n  let wait = clock()[0] * 1000 + 0.5;\n  sleep(wait);\n}\npace();\n';
    const r = (await relevant(code)).filter((x) => x.message.toLowerCase().includes('sleep'));
    expect(r.length).toBe(0);
  });
});
