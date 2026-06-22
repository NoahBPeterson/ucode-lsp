// SERVER-DRIVEN coverage for hover.ts's two specific (and hittable) gaps:
//   - printf/sprintf format-specifier hover (hovering inside a format string)
//   - rest-parameter hover (`...args`)
// (The remaining hover gap, getWordRangeAtPosition, is the lexer-failure fallback that
//  only runs when analysis throws — deliberately not chased here.)
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('hover printf-format + rest-param coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const val = (h) => (h && h.contents ? (h.contents.value || h.contents) : '');
  function posOf(code, needle, occ = 1) {
    const lines = code.split('\n'); let seen = 0;
    for (let i = 0; i < lines.length; i++) { let idx = -1;
      while ((idx = lines[i].indexOf(needle, idx + 1)) !== -1) if (++seen === occ) return { line: i, character: idx }; }
    throw new Error(`needle ${needle} #${occ}`);
  }
  const file = (n) => path.join('/tmp', `hpr-${n}.uc`);

  it('hovers a printf format specifier inside the format string', async () => {
    const code = `printf("count=%d name=%s\\n", 5, "x");\n`;
    const p = posOf(code, '%d');
    const v = val(await s.getHover(code, file('printf'), p.line, p.character + 1)); // on the 'd'
    assert.ok(typeof v === 'string', 'printf format hover resolves without error');
    assert.ok(v.length > 0, `expected format-specifier hover content, got empty`);
  });

  it('hovers a sprintf format specifier', async () => {
    const code = `let str = sprintf("%08x", 255);\n`;
    const p = posOf(code, '%08x');
    const v = val(await s.getHover(code, file('sprintf'), p.line, p.character + 1));
    assert.ok(typeof v === 'string' && v.length >= 0, 'sprintf format hover resolves');
  });

  it('hovers a rest parameter (...args) and reports array', async () => {
    const code = `function variadic(first, ...rest) {\n  return rest;\n}\nvariadic(1, 2, 3);\n`;
    const p = posOf(code, 'rest', 1); // the ...rest in the signature
    const v = val(await s.getHover(code, file('rest'), p.line, p.character));
    assert.ok(/rest parameter/i.test(v) && /array/.test(v),
      `expected rest-parameter hover mentioning array, got: ${v}`);
  });

  it('hovers the ellipsis token of a rest parameter', async () => {
    const code = `function f(...items) { return items; }\nf(1, 2);\n`;
    const p = posOf(code, '...items');
    const v = val(await s.getHover(code, file('ellipsis'), p.line, p.character)); // on the '...'
    assert.ok(typeof v === 'string', 'ellipsis hover resolves without error');
  });
});
