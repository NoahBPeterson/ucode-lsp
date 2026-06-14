// #20 audit — optional chaining (`?.`) is null-safe member access, so every member-detection
// site must treat TK_QDOT like TK_DOT. The lexer fix (o?.const) exposed that hover, definition,
// and method-call validation also keyed on TK_DOT only. They now use isMemberAccessDot, so a
// member reached via `?.` behaves exactly like one reached via `.`.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const hoverText = async (code, line, ch) => {
  const h = await s.getHover(code, `/tmp/ocp-${n++}.uc`, line, ch);
  return JSON.stringify(h?.contents ?? h ?? null);
};

test('hover on a property accessed via ?. matches plain . ', async () => {
  const dot = await hoverText('let o = { x: 42 };\nlet a = o.x;\n', 1, 10);
  const q = await hoverText('let o = { x: 42 };\nlet a = o?.x;\n', 1, 11);
  expect(q).toContain('integer');     // the property type is resolved (was null before)
  expect(q).toBe(dot);                // identical to plain-dot hover
});

test('a two-level optional chain hovers identically to the plain-dot form', async () => {
  // (two-level nested hover doesn't resolve the leaf type even with plain dots — a separate
  //  limitation; what matters here is that `?.` behaves exactly like `.`.)
  const dot = await hoverText('let o = { inner: { y: 7 } };\nlet a = o.inner.y;\n', 1, 16);
  const q = await hoverText('let o = { inner: { y: 7 } };\nlet a = o?.inner?.y;\n', 1, 18);
  expect(q).toBe(dot);
});
