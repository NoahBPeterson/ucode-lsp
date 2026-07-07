// Ticket 87 — document highlights used to be unconditionally DocumentHighlightKind.Text.
// Declarations and assignment targets must now be Write (3); plain reads must be Read (2).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
const WRITE = 3, READ = 2;
let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

test('declaration + assignment target are Write, reads are Read', async () => {
  const code = 'let x = 1;\nx = 2;\nprint(x);\n';
  const file = `/tmp/t87-${Date.now()}.uc`;
  // Cursor on the declaration `x` (line 0, char 4).
  const highlights = await server.getHighlights(code, file, 0, 4);
  expect(Array.isArray(highlights)).toBe(true);
  expect(highlights.length).toBe(3);

  const kindAtLine = (ln) => highlights.find(h => h.range.start.line === ln)?.kind;
  expect(kindAtLine(0)).toBe(WRITE); // let x = 1  (declaration)
  expect(kindAtLine(1)).toBe(WRITE); // x = 2      (assignment LHS)
  expect(kindAtLine(2)).toBe(READ);  // print(x)   (read)
});

test('function parameter binding is Write, its uses are Read', async () => {
  const code = 'function f(p) {\n  return p + p;\n}\n';
  const file = `/tmp/t87-param-${Date.now()}.uc`;
  const highlights = await server.getHighlights(code, file, 0, 11); // the `p` param
  const line0 = highlights.filter(h => h.range.start.line === 0);
  expect(line0.every(h => h.kind === WRITE)).toBe(true); // the binding
  const line1 = highlights.filter(h => h.range.start.line === 1);
  expect(line1.length).toBeGreaterThan(0);
  expect(line1.every(h => h.kind === READ)).toBe(true);  // uses
});
