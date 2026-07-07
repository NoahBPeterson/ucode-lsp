// Batch I provider fixes — signature-help tickets 83, 84, 85, 171.
const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-batch-i-sighelp.uc');

async function sigAt(content, line, character) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    return await server.getSignatureHelp(content, fp, line, character);
  } finally {
    server.shutdown();
  }
}

// #83 — local object-literal method call.
test('#83 local object method signature help', async () => {
  const content = `let o = { run: function(a, b) {} };\no.run(1, 2);\n`;
  const sig = await sigAt(content, 1, 6); // inside o.run(
  expect(sig).toBeTruthy();
  expect(sig.signatures[0].label).toBe('o.run(a, b)');
});

// #84 — this.method() inside an object method.
test('#84 this.method signature help', async () => {
  const content = `let obj = {\n  greet: function(name) {},\n  go: function() { this.greet("x"); }\n};\n`;
  const sig = await sigAt(content, 2, 30); // inside this.greet(
  expect(sig).toBeTruthy();
  expect(sig.signatures[0].label).toBe('this.greet(name)');
});

// #85 — unclosed call at true EOF.
test('#85 unclosed call at EOF still shows signature', async () => {
  const content = `function f(a, b) {}\nf(1,\n`;
  const sig = await sigAt(content, 2, 0); // EOF right after trailing newline
  expect(sig).toBeTruthy();
  expect(sig.signatures[0].label).toBe('f(a, b)');
  expect(sig.activeParameter).toBe(1);
});

test('#85 unclosed call, no trailing newline', async () => {
  const content = `function f(a, b) {}\nf(1, `;
  const sig = await sigAt(content, 1, 5); // EOF after trailing space
  expect(sig).toBeTruthy();
  expect(sig.signatures[0].label).toBe('f(a, b)');
});

// #171 — namespace-import member call (user module).
test('#171 namespace import member signature help', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-i-171-'));
  const nsf = path.join(dir, 'nsf.uc');
  fs.writeFileSync(nsf, `export function add(a, b) { return a + b; }\n`);
  const main = path.join(dir, 'main.uc');
  const content = `import * as m from './nsf.uc';\nm.add(1,\n`;
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const sig = await server.getSignatureHelp(content, main, 1, 8); // inside m.add(1,
    expect(sig).toBeTruthy();
    expect(sig.signatures[0].label).toBe('m.add(a, b)');
    expect(sig.activeParameter).toBe(1);
  } finally {
    server.shutdown();
  }
});
