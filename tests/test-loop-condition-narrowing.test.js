// Regression for auto-docs findings #136 / #137: a truthiness/type test in a
// `while` or `for` condition must narrow the subject inside the loop body, just
// like the identical `if` form. `collectGuards` (typeChecker.ts) had no
// WhileStatement / ForStatement case, so `while (x) { substr(x,0) }` kept flagging
// x as possibly-null even though the condition proves it non-null in the body.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let getDiagnostics;
beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
});

const PRE = "import { readfile } from 'fs';\nlet x = readfile('/a');\n"; // x: string | null
async function nullFlags(code, file) {
  const diags = await getDiagnostics(code, file);
  return diags.filter((d) => /may be null|Argument 1 of substr/i.test(d.message));
}

describe('#136/#137 loop-condition narrowing', () => {
  const narrowed = {
    'while (x)':                'while (x) { substr(x, 0, 2); break; }',
    'while (x != null)':        'while (x != null) { substr(x, 0, 2); break; }',
    'while (type(x)=="string")':'while (type(x) == "string") { substr(x, 0, 2); break; }',
    'for (; x; )':              'for (; x; ) { substr(x, 0, 2); break; }',
    'for (; x != null; )':      'for (; x != null; ) { substr(x, 0, 2); break; }',
  };
  for (const [label, loop] of Object.entries(narrowed)) {
    test(`${label} narrows the subject in the body (no false nullable)`, async () => {
      const flags = await nullFlags(PRE + loop + '\n', `/tmp/lcn-${label.replace(/\W+/g, '_')}.uc`);
      expect(flags.map((d) => d.message)).toEqual([]);
    });
  }

  test('the if-form was and stays clean (baseline)', async () => {
    const flags = await nullFlags(PRE + 'if (x) { substr(x, 0, 2); }\n', '/tmp/lcn-if.uc');
    expect(flags).toEqual([]);
  });

  test('a non-guarding loop condition still flags (no over-narrowing)', async () => {
    // `while (true)` says nothing about x → x is still possibly-null in the body.
    const flags = await nullFlags(PRE + 'while (true) { substr(x, 0, 2); break; }\n', '/tmp/lcn-true.uc');
    expect(flags.length).toBeGreaterThan(0);
  });

  test('the canonical read-line idiom narrows the assigned var', async () => {
    const code = "import { open } from 'fs';\n"
      + "let fh = open('/a', 'r');\n"
      + "if (fh) {\n  let line;\n  while ((line = fh.read('line'))) { substr(line, 0, 2); }\n}\n";
    const flags = await nullFlags(code, '/tmp/lcn-idiom.uc');
    expect(flags.map((d) => d.message)).toEqual([]);
  });
});
