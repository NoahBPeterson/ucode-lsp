// E2e hover tests for object-literal property KEYS, driving the real LSP server.
// These exercise hover.ts's formatPropertyValueHover (the AST-based renderer for
// a property's value: function/arrow/literal/array/object), whose function and
// arrow branches were uncovered.

const assert = require('assert');
const { createLSPTestServer } = require('../lsp-test-helpers');

function posOf(code, sub, occurrence = 1) {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = code.indexOf(sub, idx + 1);
    if (idx === -1) throw new Error(`substring not found (${occurrence}x): ${sub}`);
  }
  const pre = code.slice(0, idx);
  return { line: (pre.match(/\n/g) || []).length, character: idx - (pre.lastIndexOf('\n') + 1) + 1 };
}
function hoverText(h) {
  if (!h || !h.contents) return '';
  return typeof h.contents === 'string' ? h.contents : (h.contents.value || '');
}

describe('Object-literal property-key hover (e2e)', function () {
  this.timeout(15000);
  let getHover;

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getHover = server.getHover;
  });

  // One object literal with every value kind; hover each KEY.
  const code =
    'let o = {\n' +
    '  fnProp: function(a, b) { return a; },\n' +
    '  arrowNum: (x) => 5,\n' +
    '  arrowStr: () => "hi",\n' +
    '  arrowBool: () => true,\n' +
    '  strProp: "hello",\n' +
    '  numProp: 42,\n' +
    '  boolProp: true,\n' +
    '  nullProp: null,\n' +
    '  arrProp: [1, 2],\n' +
    '  objProp: { a: 1 }\n' +
    '};\n';

  const cases = [
    ['fnProp', 'Function expression'],
    ['arrowNum', '=> number'],
    ['arrowStr', '=> string'],
    ['arrowBool', '=> boolean'],
    ['strProp', 'String literal'],
    ['numProp', 'Number literal'],
    ['boolProp', 'Boolean literal'],
    ['nullProp', 'Null literal'],
    ['arrProp', 'Array literal'],
    ['objProp', 'Object literal'],
  ];

  for (const [key, expected] of cases) {
    it(`hovers property \`${key}\` → ${expected}`, async () => {
      const p = posOf(code, key + ':');
      const h = await getHover(code, '/tmp/objlit-prop-hover.uc', p.line, p.character);
      const text = hoverText(h);
      assert.ok(text, `expected a hover for property \`${key}\``);
      assert.ok(
        text.includes(expected),
        `property \`${key}\`: expected "${expected}", got: ${text.replace(/\n/g, ' ').slice(0, 100)}`
      );
    });
  }
});
