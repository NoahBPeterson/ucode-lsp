// (A) A member property that shares a name with a builtin must NOT hover as the
//     builtin (best[k].signal is a property, not the `signal()` builtin).
// (B) A `type(o.x) == "str"` guard narrows the member path o.x in the branch —
//     reflected in hover AND in a function's inferred return type.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';
async function hoverFirst(content, fp, lineIdx, colFinder) {
  await server.getDiagnostics(content, fp);
  return firstLine(await server.getHover(content, fp, lineIdx, colFinder(content.split('\n')[lineIdx])));
}

test('A: a member property named like a builtin (.signal) hovers as a property, not the builtin', async () => {
  const c = `let best = {};\nlet k = "x";\nif (best[k].signal >= 0) print("hi");\n`;
  const got = await hoverFirst(c, '/tmp/mhn-a.uc', 2, (l) => l.indexOf('.signal') + 1);
  expect(got).not.toContain('built-in function');
  expect(got).toContain('signal');
});

test('A: the real signal() builtin still hovers as a built-in function', async () => {
  const c = `let h = signal(2, () => {});\n`;
  const got = await hoverFirst(c, '/tmp/mhn-a2.uc', 0, (l) => l.indexOf('signal('));
  expect(got).toContain('built-in function');
});

test('A: a computed/call base property (f().signal) also avoids the builtin', async () => {
  const c = `function mk() { return {}; }\nif (mk().signal >= 0) print("x");\n`;
  const got = await hoverFirst(c, '/tmp/mhn-a3.uc', 1, (l) => l.indexOf('.signal') + 1);
  expect(got).not.toContain('built-in function');
});

test('B: type(o.x)=="string" narrows the member in the guarded branch', async () => {
  const c = `function f(iface) {\n    if (type(iface.ifname) == "string")\n        return iface.ifname;\n    return iface.ifname;\n}\n`;
  const fp = '/tmp/mhn-b.uc';
  expect(await hoverFirst(c, fp, 2, (l) => l.indexOf('ifname'))).toContain('string');
  expect(await hoverFirst(c, fp, 3, (l) => l.indexOf('ifname'))).toContain('unknown');
});

test('B: a function returning the narrowed member infers string | null', async () => {
  const c = `function f(iface) {\n    if (type(iface.ifname) == "string")\n        return iface.ifname;\n    return null;\n}\nlet r = f({});\n`;
  const fp = '/tmp/mhn-b2.uc';
  // hover the binding `r` — should be string | null, not unknown | null
  const got = await hoverFirst(c, fp, 5, (l) => l.indexOf('r '));
  expect(got).toContain('string | null');
});
