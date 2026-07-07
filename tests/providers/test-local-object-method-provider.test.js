// Plain local object-literal method: `let o = { m: function(){} }; o.m()`.
// Regression coverage for two provider gaps:
//   - ticket 42: find-references / document-highlight on the method missed every call site
//   - ticket 86: parameter-name inlay hints were absent for the method call
// Both are driven end-to-end through the spawned LSP server.
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-local-obj-method.uc');
const KIND_PARAM = 2; // InlayHintKind.Parameter

// `let o = { run: function(a, b){} };` then two call sites.
const CONTENT =
`let o = { run: function(alpha, beta) { return alpha + beta; } };
o.run(1, 2);
o.run(3, 4);
`;

function keyList(refs) {
  return (refs || []).map((r) => `${r.range.start.line}:${r.range.start.character}`).sort();
}

test('ticket 42: references on a call-site member return the definition + both calls', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    // cursor on `run` of `o.run(1, 2)` (line 1, col 2)
    const refs = await server.getReferences(CONTENT, fp, 1, 2, true);
    const keys = keyList(refs);
    // definition key `run:` on line 0 (col 10) + both call sites (line 1 & 2, col 2)
    expect(keys).toContain('0:10');
    expect(keys).toContain('1:2');
    expect(keys).toContain('2:2');
    expect(refs.length).toBe(3);
  } finally { server.shutdown(); }
});

test('ticket 42: references on the object-literal key resolve the same set', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    // cursor on the `run` KEY (line 0, col 10)
    const refs = await server.getReferences(CONTENT, fp, 0, 10, true);
    const keys = keyList(refs);
    expect(keys).toContain('0:10');
    expect(keys).toContain('1:2');
    expect(keys).toContain('2:2');
    expect(refs.length).toBe(3);
  } finally { server.shutdown(); }
});

test('ticket 42: excludeDeclaration drops the definition key', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const refs = await server.getReferences(CONTENT, fp, 1, 2, false);
    const keys = keyList(refs);
    expect(keys).not.toContain('0:10');
    expect(keys).toContain('1:2');
    expect(keys).toContain('2:2');
    expect(refs.length).toBe(2);
  } finally { server.shutdown(); }
});

test('ticket 42: document-highlight highlights every call site', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const hl = await server.getHighlights(CONTENT, fp, 1, 2);
    const keys = keyList(hl);
    expect(keys).toContain('0:10');
    expect(keys).toContain('1:2');
    expect(keys).toContain('2:2');
  } finally { server.shutdown(); }
});

test('ticket 86: call site gets parameter-name inlay hints', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const lines = CONTENT.split('\n').length;
    const hints = await server.getInlayHints(
      CONTENT, fp, { line: 0, character: 0 }, { line: lines, character: 0 }
    );
    const params = (hints || [])
      .filter((h) => h.kind === KIND_PARAM && h.position.line === 1)
      .map((h) => (typeof h.label === 'string' ? h.label : ''));
    expect(params).toContain('alpha:');
    expect(params).toContain('beta:');
  } finally { server.shutdown(); }
});

test('ticket 86 (bonus): signature help resolves the local method params', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    // cursor inside the arg list of `o.run(1, 2)` (line 1, just after `(`)
    const sig = await server.getSignatureHelp(CONTENT, fp, 1, 6);
    expect(sig).toBeTruthy();
    expect(sig.signatures.length).toBeGreaterThan(0);
    expect(sig.signatures[0].label).toBe('o.run(alpha, beta)');
  } finally { server.shutdown(); }
});
