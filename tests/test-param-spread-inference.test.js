// An unannotated parameter spread in a call or array literal (`f(...p)`, `[...p]`)
// is inferred as `array`. Object-literal spread (`{...p}`) is NOT — it implies an
// object — and an explicit @param annotation always wins.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';
async function paramHover(content, tag, lineIdx, token) {
  const fp = `/tmp/psi-${tag}.uc`;
  await server.getDiagnostics(content, fp);
  return firstLine(await server.getHover(content, fp, lineIdx, content.split('\n')[lineIdx].indexOf(token) + 1));
}

test('call-spread infers array (the sprintf(...mac) case)', async () => {
  expect(await paramHover(`function f(mac) { return sprintf("%x", ...mac); }\n`, 'call', 0, '(mac')).toContain('array');
});

test('array-literal spread infers array', async () => {
  expect(await paramHover(`function g(xs) { return [...xs]; }\n`, 'arr', 0, '(xs')).toContain('array');
});

test('arrow function call-spread infers array', async () => {
  expect(await paramHover(`let h = (ys) => max(...ys);\n`, 'arrow', 0, '(ys')).toContain('array');
});

test('no spread leaves the param unknown', async () => {
  expect(await paramHover(`function k(z) { return z + 1; }\n`, 'none', 0, '(z')).toContain('unknown');
});

test('object-literal spread does NOT infer array', async () => {
  const t = await paramHover(`function m(o) { return {...o}; }\n`, 'obj', 0, '(o');
  expect(t).not.toContain('array');
});

test('an explicit @param annotation is not clobbered', async () => {
  const c = `/**\n * @param {object} mac\n */\nfunction f(mac) { return sprintf("%x", ...mac); }\n`;
  expect(await paramHover(c, 'annot', 3, '(mac')).toContain('object');
});

test('the inferred array flows into the function signature (no spurious UC2006)', async () => {
  // mac inferred array; the spread call must not be re-flagged for arg count.
  const c = `function f(mac) { return sprintf("%02x:%02x:%02x", ...mac); }\n`;
  const d = await server.getDiagnostics(c, '/tmp/psi-sig.uc');
  expect((d || []).find((x) => x.code === 'UC2006')).toBeUndefined();
});
