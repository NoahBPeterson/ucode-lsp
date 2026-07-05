// UC6015 — ucode's alt colon-block syntax (`if (x): … elif (y): … endif`, `for (…): … endfor`,
// `while (…): … endwhile`, `function …: … endfunction`) requires a `:` after the opener's
// condition. Forget it and the terminator/continuation keyword lands in statement position,
// where the parser used to emit the cryptic "Unexpected token in expression". Now it emits a
// targeted UC6015 pointing at the missing colon, and recovers past the keyword.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/scbk-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const stray = async (code) => (await diags(code)).filter((d) => d.code === 'UC6015');

// ── must flag a missing colon (with a helpful message) ───────────────────────
test('`elif`/`endif` without the colon after `if` → UC6015 on each', async () => {
  const ds = await stray("if (x)\n  print('a');\nelif (y)\n  print('b');\nendif\n");
  expect(ds.length).toBe(2);
  expect(ds[0].message).toContain("'elif'");
  expect(ds[0].message).toContain("colon-block");
  expect(ds[0].message).toContain("':'");
  expect(ds[1].message).toContain("'endif'");
});
test('`endfor` without the colon after `for`', async () => {
  expect((await stray("for (let i = 0; i < 2; i++)\n  print(i);\nendfor\n")).length).toBe(1);
});
test('`endwhile` without the colon after `while`', async () => {
  expect((await stray("while (x)\n  print(x);\nendwhile\n")).length).toBe(1);
});
test('a stray `endfunction` (no function to close) is flagged', async () => {
  // NB: `function f(): … endfunction` (the function colon-form, which ucode DOES support) is
  // a separate parser gap — our function-decl parser requires braces, so `endfunction` only
  // reaches the statement-level check when there's no function opener to consume it.
  const ds = await stray("print('a');\nendfunction\n");
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain("'endfunction'");
});
test('the message anchors on the keyword token itself', async () => {
  const ds = await stray("if (x)\n  print('a');\nendif\n");
  expect(ds.length).toBe(1);
  expect(ds[0].range.start.line).toBe(2);      // the `endif` line
  expect(ds[0].range.start.character).toBe(0);
});
test('a stray keyword with no matching opener at all is still flagged', async () => {
  expect((await stray("print('a');\nendif\n")).length).toBe(1);
});

// ── must stay clean (the valid colon-block form) ─────────────────────────────
test('the valid `if (x): … elif (y): … else: … endif` form has no UC6015', async () => {
  expect((await stray("if (x):\n  print('a');\nelif (y):\n  print('b');\nelse:\n  print('c');\nendif\n")).length).toBe(0);
});
test('valid `for (…): … endfor` / `while (…): … endwhile`', async () => {
  expect((await stray("for (let i = 0; i < 2; i++):\n  print(i);\nendfor\n")).length).toBe(0);
  expect((await stray("while (x):\n  print(x);\nendwhile\n")).length).toBe(0);
});
test('ordinary brace-form control flow is untouched', async () => {
  expect((await stray("if (x) {\n  print('a');\n} else if (y) {\n  print('b');\n}\n")).length).toBe(0);
});

// ── recovery: the body after the stray keyword still parses (no cascade) ──────
test('recovery keeps analyzing after the stray keyword', async () => {
  // `undefined_thing` after the endif must still be reached (proves recovery, no cascade halt).
  const ds = await diags("if (x)\n  print('a');\nendif\nlet z = undefined_thing;\n");
  expect(ds.some((d) => d.code === 'UC1001' && /undefined_thing/.test(d.message))).toBe(true);
});
