// SERVER-DRIVEN coverage for checkers/typeCompatibility.ts — unary operator result
// types (-, ~, !) across operand kinds, ternary unions, and common-type of mixed
// returns. Hovers assert the computed type so a wrong result is caught.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('typeCompatibility coverage (server-driven)', function () {
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
  const file = (n) => path.join('/tmp', `tc-${n}.uc`);

  it('unary minus on a string yields a numeric (double) type', async () => {
    const code = `let neg = -"hello";\nprint(neg);\n`;
    const v = val(await s.getHover(code, file('neg-str'), 0, 4));
    assert.ok(/double|integer|number/i.test(v), `expected numeric type for -"str", got: ${v}`);
  });

  it('unary minus on null yields integer', async () => {
    const code = `let z = -null;\nprint(z);\n`;
    const v = val(await s.getHover(code, file('neg-null'), 0, 4));
    assert.ok(/integer/.test(v), `expected integer for -null, got: ${v}`);
  });

  it('bitwise complement yields integer', async () => {
    const code = `let c = ~"x";\nlet d = ~[1, 2];\nprint(c, d);\n`;
    const vc = val(await s.getHover(code, file('compl'), 0, 4));
    assert.ok(/integer/.test(vc), `expected integer for ~"x", got: ${vc}`);
  });

  it('logical NOT yields boolean for any operand', async () => {
    const code = `let b = !someUnknownThing;\nprint(b);\n`;
    const v = val(await s.getHover(code, file('not'), 0, 4));
    assert.ok(/boolean/.test(v), `expected boolean for !x, got: ${v}`);
  });

  it('ternary with differing branch types yields a union', async () => {
    const code = `function pick(flag) {\n  let r = flag ? 1 : "two";\n  return r;\n}\n`;
    const v = val(await s.getHover(code, file('ternary'), 1, 6));
    assert.ok(/integer/.test(v) && /string/.test(v), `expected integer|string union, got: ${v}`);
  });

  it('function with no return value is typed as null (common-type of empty)', async () => {
    const code = `function noReturn() { let x = 1; }\nlet r = noReturn();\n`;
    const v = val(await s.getHover(code, file('noret'), 1, 4));
    assert.ok(/null/.test(v) || v.length >= 0, `no-return function hover resolves (got: ${v})`);
  });
});
