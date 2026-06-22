// Element-typed arrays in JSDoc @param: `array<T>`, `Array<T>`, and `T[]` all
// resolve to ucode's `array<T>`, and the element type propagates to indexing and
// for-in iteration.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';

// Hover the parameter `p` in a function annotated with the given @param type form.
async function paramType(form, tag) {
  const c = `/**\n * @param {${form}} p\n */\nfunction f(p) { return p; }\n`;
  const fp = `/tmp/jat-${tag}.uc`;
  await server.getDiagnostics(c, fp);
  return firstLine(await server.getHover(c, fp, 3, c.split('\n')[3].indexOf('(p') + 1));
}

test('array<string> resolves to array<string>', async () => {
  expect(await paramType('array<string>', 'angle')).toContain('array<string>');
});
test('Array<string> (capitalized) resolves to array<string>', async () => {
  expect(await paramType('Array<string>', 'cap')).toContain('array<string>');
});
test('string[] (bracket form) resolves to array<string>', async () => {
  expect(await paramType('string[]', 'bracket')).toContain('array<string>');
});
test('integer[] resolves to array<integer>', async () => {
  expect(await paramType('integer[]', 'int')).toContain('array<integer>');
});
test('array<fs.file> resolves to array<fs.file>', async () => {
  expect(await paramType('array<fs.file>', 'obj')).toContain('array<fs.file>');
});
test('bare array is unchanged (untyped)', async () => {
  const t = await paramType('array', 'bare');
  expect(t).toContain('array');
  expect(t).not.toContain('<');
});

test('element type propagates to indexing and for-in', async () => {
  const c = `/**\n * @param {string[]} params\n */\nfunction f(params) {\n    let first = params[0];\n    for (let p in params)\n        print(p);\n}\n`;
  const fp = '/tmp/jat-prop.uc';
  await server.getDiagnostics(c, fp);
  const ls = c.split('\n');
  expect(firstLine(await server.getHover(c, fp, 4, ls[4].indexOf('first')))).toContain('string | null');
  expect(firstLine(await server.getHover(c, fp, 6, ls[6].indexOf('p)')))).toContain('string');
});
