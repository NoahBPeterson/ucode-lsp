// Inlay TYPE-hint coverage: which initializers get a `: <type>` hint.
// Annotate calls, member access, identifier aliases, and logical/binary exprs that
// carry a concrete type; skip self-evident literal forms (number/array/object).
const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-inlay-coverage.uc');
const KIND_TYPE = 1; // InlayHintKind.Type

async function typeHintsFor(content) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const lines = content.split('\n').length;
    const hints = await server.getInlayHints(
      content, fp, { line: 0, character: 0 }, { line: lines, character: 0 }
    );
    return (hints || [])
      .filter((h) => h.kind === KIND_TYPE)
      .map((h) => ({ line: h.position.line, label: typeof h.label === 'string' ? h.label : '' }));
  } finally {
    server.shutdown();
  }
}

test('logical `x || require(mod)` gets a module type hint', async () => {
  const content = `function f(fs_mod) {
    let _fs = fs_mod || require('fs');
    return _fs;
}
`;
  const hints = await typeHintsFor(content);
  const line1 = hints.find((h) => h.line === 1);
  expect(line1).toBeTruthy();
  expect(line1.label).toBe(': fs module');
});

test('identifier alias of a typed variable gets a type hint', async () => {
  const content = `function make() { return { x: 1 }; }
function f() {
    let output = make();
    let a = output;
    return a;
}
`;
  const hints = await typeHintsFor(content);
  // `let output = make()` (line 2) and `let a = output` (line 3) both -> : object
  expect(hints.find((h) => h.line === 2)?.label).toBe(': object');
  expect(hints.find((h) => h.line === 3)?.label).toBe(': object');
});

test('single-parameter calls show their parameter-name hint', async () => {
  // `require('fs')` has one documented param (`module`); the hint is shown.
  const content = `function f(fs_mod) {
    let _fs = fs_mod || require('fs');
    return _fs;
}
`;
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const lines = content.split('\n').length;
    const hints = await server.getInlayHints(
      content, fp, { line: 0, character: 0 }, { line: lines, character: 0 }
    );
    const labels = (hints || []).filter((h) => h.kind === 2).map((h) => h.label);
    expect(labels).toContain('module:');
  } finally {
    server.shutdown();
  }
});

test('multi-parameter calls still get parameter-name hints', async () => {
  const content = `function make(a, b) { return {}; }
function f() {
    let x = make(1, 2);
    return x;
}
`;
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const lines = content.split('\n').length;
    const hints = await server.getInlayHints(
      content, fp, { line: 0, character: 0 }, { line: lines, character: 0 }
    );
    const labels = (hints || []).filter((h) => h.kind === 2).map((h) => h.label);
    expect(labels).toContain('a:');
    expect(labels).toContain('b:');
  } finally {
    server.shutdown();
  }
});

test('ucode.inlayHints.enable=false suppresses all inlay hints', async () => {
  // Fresh, non-shared server rooted at a small empty temp dir (so workspace scan is
  // fast) that advertises the configuration capability and returns the disabled
  // setting via the injected config map.
  const wsRoot = '/tmp/test-inlay-disabled';
  fs.mkdirSync(wsRoot, { recursive: true });
  const file = path.join(wsRoot, 'main.uc');
  const server = createLSPTestServer({
    workspaceRoot: wsRoot,
    capabilities: { workspace: { configuration: true, inlayHint: { refreshSupport: true } } },
    configuration: { 'ucode.inlayHints': { enable: false } },
  });
  try {
    await server.initialize();
    const content = `function make(a, b) { return {}; }
function f(fs_mod) {
    let _fs = fs_mod || require('fs');
    let x = make(1, 2);
    return x;
}
`;
    const lines = content.split('\n').length;
    const hints = await server.getInlayHints(
      content, file, { line: 0, character: 0 }, { line: lines, character: 0 }
    );
    expect((hints || []).length).toBe(0);
  } finally {
    server.shutdown();
  }
});

test('self-evident literal initializers get NO type hint', async () => {
  const content = `function f() {
    let n = 5;
    let s = "hi";
    let arr = [1, 2, 3];
    let o = { a: 1 };
    return n;
}
`;
  const hints = await typeHintsFor(content);
  // Lines 1-4 are literal/array/object initializers — none should be annotated.
  expect(hints.filter((h) => h.line >= 1 && h.line <= 4).length).toBe(0);
});
