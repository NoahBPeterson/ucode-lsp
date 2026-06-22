// Spreading a parameter is NOT a type fact about what's passed in — it's a
// precondition the body imposes on callers, which the LSP never verifies. So:
//   - the param's type stays `unknown` (honest),
//   - UC7003 ("document this param") still fires,
//   - and the spread only feeds the EXISTING Add-JSDoc usage inference, proposing
//     `{array}` (call/array spread) or `{array | object}` (object spread) as an
//     editable suggestion — the same path as push()->array etc.
// Once the human accepts that annotation, it's a declared contract and hover shows
// the type through the ordinary @param pipeline (covered by JSDoc tests elsewhere).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';

// The text the "Add JSDoc" quick fix would insert for the function on `funcLine`.
async function addJsDocText(content, tag) {
  const fp = `/tmp/psi-${tag}.uc`;
  const d = await server.getDiagnostics(content, fp);
  const jd = (d || []).find((x) => x.code === 'UC7003'
    || ((x.code === 'incompatible-function-argument' || x.code === 'nullable-argument') && x.data && x.data.variableName));
  if (!jd) return null;
  const acts = await server.getCodeActions(fp, [jd], jd.range.start.line, jd.range.start.character);
  const fix = (acts || []).find((a) => /JSDoc/i.test(a.title));
  if (!fix || !fix.edit || !fix.edit.changes) return null;
  return Object.values(fix.edit.changes)[0][0].newText;
}

test('a spread param is NOT assumed to be array — it stays unknown', async () => {
  const c = `function mac_array_string(mac) { return sprintf("%02x", ...mac); }\n`;
  const fp = '/tmp/psi-unknown.uc';
  await server.getDiagnostics(c, fp);
  const h = await server.getHover(c, fp, 0, c.indexOf('(mac') + 1);
  expect(firstLine(h)).toContain('unknown');
});

test('UC7003 still fires for a spread param (contract is undocumented)', async () => {
  const c = `'use strict';\nfunction mac_array_string(mac) { return sprintf("%02x", ...mac); }\n`;
  const d = await server.getDiagnostics(c, '/tmp/psi-uc7003.uc');
  expect((d || []).some((x) => x.code === 'UC7003')).toBe(true);
});

test('Add-JSDoc suggests {array} from a call-spread', async () => {
  const c = `'use strict';\nfunction mac_array_string(mac) { return sprintf("%02x", ...mac); }\n`;
  expect(await addJsDocText(c, 'call')).toContain('@param {array} mac');
});

test('Add-JSDoc suggests {array} from an array-literal spread', async () => {
  const c = `'use strict';\nfunction g(xs) { return length([...xs]); }\n`;
  expect(await addJsDocText(c, 'arrlit')).toContain('@param {array} xs');
});

test('Add-JSDoc suggests {array | object} from an object-literal spread', async () => {
  const c = `'use strict';\nfunction h(o) { return {...o}; }\n`;
  expect(await addJsDocText(c, 'objlit')).toContain('@param {array | object} o');
});

test('a spread arg does not invent a call-site contract (no false arg error)', async () => {
  // mac is unknown, so calling with a string must NOT be flagged against an
  // assumed array signature.
  const c = `function f(mac) { return sprintf("%x", ...mac); }\nf("aabbcc");\n`;
  const d = await server.getDiagnostics(c, '/tmp/psi-callsite.uc');
  const argErr = (d || []).find((x) => x.code === 'incompatible-function-argument' && x.range.start.line === 1);
  expect(argErr).toBeUndefined();
});
