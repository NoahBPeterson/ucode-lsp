// Batch I provider fixes — hover tickets 43, 114, 173, 177.
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-batch-i-hover.uc');

async function hoverAt(content, line, character) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const h = await server.getHover(content, fp, line, character);
    return (h && h.contents && h.contents.value) || '';
  } finally {
    server.shutdown();
  }
}

// #43 — function hover renders the parameter list.
test('#43 function hover shows name(params)', async () => {
  const content = `function add(a, b) { return a + b; }\nadd(1, 2);\n`;
  const text = await hoverAt(content, 0, 9); // on `add`
  expect(text).toContain('add(a, b)');
});

// #114 — free-standing scalar literals get a hover.
test('#114 number literal hover', async () => {
  const text = await hoverAt(`let x = 42;\n`, 0, 8); // on 42
  expect(text).toContain('42');
  expect(text).toContain('integer');
});

test('#114 string literal hover', async () => {
  const text = await hoverAt(`let y = "hi";\n`, 0, 9); // inside "hi"
  expect(text).toContain('string');
});

test('#114 boolean literal hover', async () => {
  const text = await hoverAt(`let z = true;\n`, 0, 9); // on true
  expect(text).toContain('boolean');
});

test('#114 null literal hover', async () => {
  const text = await hoverAt(`let w = null;\n`, 0, 9); // on null
  expect(text).toContain('null');
});

// #173 — two-level member access on a local object literal.
test('#173 two-level member a.b.c resolves', async () => {
  const content = `let a = { b: { c: 5 } };\nlet x = a.b.c;\nprint(x);\n`;
  const text = await hoverAt(content, 1, 12); // on `.c`
  expect(text).toContain('integer');
});

// #177 — regex type displays as `regexp` (matches ucode's type()).
test('#177 regex hover shows regexp', async () => {
  const content = `let r = /abc/;\nr;\n`;
  const text = await hoverAt(content, 1, 0); // on r
  expect(text).toContain('regexp');
  expect(text).not.toMatch(/`regex`/);
});
