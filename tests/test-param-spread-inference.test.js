// Spread of an unannotated parameter is typed by the spread context (verified
// against the ucode interpreter): call / array-literal spread (`f(...p)`, `[...p]`)
// only accepts an array → `array`; object-literal spread (`{...p}`) accepts an array
// OR an object → `array | object`. An explicit @param annotation always wins.
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

test('object-literal spread infers array | object (ucode accepts both)', async () => {
  const t = await paramHover(`function m(o) { return {...o}; }\n`, 'obj', 0, '(o');
  expect(t).toContain('array | object');
});

test('a param spread in both call and object contexts resolves to array (call wins)', async () => {
  const t = await paramHover(`function g(p) { foo(...p); return {...p}; }\n`, 'both', 0, '(p');
  expect(t).toContain('array');
  expect(t).not.toContain('object');
});

test('an explicit @param annotation is not clobbered', async () => {
  const c = `/**\n * @param {object} mac\n */\nfunction f(mac) { return sprintf("%x", ...mac); }\n`;
  expect(await paramHover(c, 'annot', 3, '(mac')).toContain('object');
});

// UC7003 ("param has unknown type, annotate it") must not fire for a param whose
// type we inferred from spread usage — it isn't unknown anymore. A genuinely
// untyped param still gets the hint. (UC7003 is strict-mode only.)
async function uc7003Params(content, tag) {
  const d = await server.getDiagnostics(content, `/tmp/psi7-${tag}.uc`);
  const u = (d || []).find((x) => x.code === 'UC7003');
  return u ? u.message : null;
}

test('UC7003 does not fire for a spread-inferred param', async () => {
  const c = `'use strict';\nfunction mac_array_string(mac) { return sprintf("%02x", ...mac); }\n`;
  expect(await uc7003Params(c, 'spread')).toBeNull();
});

test('UC7003 does not fire for an object-spread-inferred param', async () => {
  const c = `'use strict';\nfunction h(o) { return {...o}; }\n`;
  expect(await uc7003Params(c, 'objspread')).toBeNull();
});

test('UC7003 still fires for a genuinely untyped param (control)', async () => {
  const c = `'use strict';\nfunction g(z) { return z + 1; }\n`;
  const msg = await uc7003Params(c, 'control');
  expect(msg).not.toBeNull();
  expect(msg).toContain('z');
});

test('the inferred array flows into the function signature (no spurious UC2006)', async () => {
  // mac inferred array; the spread call must not be re-flagged for arg count.
  const c = `function f(mac) { return sprintf("%02x:%02x:%02x", ...mac); }\n`;
  const d = await server.getDiagnostics(c, '/tmp/psi-sig.uc');
  expect((d || []).find((x) => x.code === 'UC2006')).toBeUndefined();
});
