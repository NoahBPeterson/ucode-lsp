// The "Add JSDoc" quick fix must only be offered where a leading JSDoc block can
// actually attach: a function declaration, or a function expression that's the value
// of a variable/assignment/property. For an inline anonymous callback argument
// (e.g. `replace(s, re, function(ip){…})`), inserting the block before the enclosing
// statement detaches it and never annotates the param — so it must NOT be offered.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// Does the JSDoc quick fix get offered for the diagnostic on `varName`?
async function jsdocOffered(content, tag, varName) {
  const fp = `/tmp/jqa-${tag}.uc`;
  const d = await server.getDiagnostics(content, fp);
  const jd = (d || []).find((x) => x.code === 'incompatible-function-argument' && x.data && x.data.variableName === varName);
  if (!jd) return 'no-trigger';
  const acts = await server.getCodeActions(fp, [jd], jd.range.start.line, jd.range.start.character);
  return (acts || []).some((a) => /JSDoc/i.test(a.title)) ? 'offered' : 'not-offered';
}

test('offered for a function declaration', async () => {
  expect(await jsdocOffered(`function f(x) { return substr(x, 0); }\n`, 'decl', 'x')).toBe('offered');
});

test('offered for an assigned function expression', async () => {
  expect(await jsdocOffered(`let g = function(x) { return substr(x, 0); };\n`, 'assign', 'x')).toBe('offered');
});

test('offered for an object-property function value', async () => {
  expect(await jsdocOffered(`let o = { m: function(x) { return substr(x, 0); } };\n`, 'prop', 'x')).toBe('offered');
});

test('NOT offered for an inline callback argument (no attachment point)', async () => {
  const c = `function h(arr) { return map(arr, function(x) { return substr(x, 0); }); }\n`;
  expect(await jsdocOffered(c, 'cb', 'x')).toBe('not-offered');
});

test('NOT offered for a replace()-callback argument (the pbr shape)', async () => {
  const c = `function p(line) {
    let masked = line;
    masked = replace(masked, /x/g, function(ip) { return substr(ip, 0); });
    return masked;
}
`;
  // The JSDoc quick fix must never be offered for a replace() inline callback (no
  // attachment point). Since finding #178, replace's callback params are correctly typed
  // as strings, so `substr(ip, 0)` no longer even produces a spurious "unknown argument"
  // diagnostic — hence 'no-trigger'. Either way the fix is not offered.
  expect(await jsdocOffered(c, 'pbr', 'ip')).not.toBe('offered');
});
