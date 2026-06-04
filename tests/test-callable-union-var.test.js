// Calling a variable whose type is a union that includes `function` (e.g. the
// `function | null` returned by loadstring()) must NOT report "Undefined function".
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

const fp = path.join(__dirname, 'temp-callable-union.uc');

async function undefinedFnDiags(content) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const d = await server.getDiagnostics(content, fp);
    return d.filter((x) => /undefined function/i.test(x.message || ''));
  } finally {
    server.shutdown();
  }
}

test('calling a loadstring() result (function|null) is not "Undefined function"', async () => {
  const content = `function f(code) {
    let fn = loadstring('' + code);
    if (!fn) return 1;
    let direct = fn();
    try { return fn(); } catch (e) { return 2; }
}
`;
  expect((await undefinedFnDiags(content)).length).toBe(0);
});

test('a genuinely undefined callee is still flagged', async () => {
  const content = `function f() {
    return not_a_function();
}
`;
  const diags = await undefinedFnDiags(content);
  expect(diags.length).toBeGreaterThanOrEqual(1);
});
