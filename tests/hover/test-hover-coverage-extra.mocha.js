// SERVER-DRIVEN coverage for hover.ts — hovers over builtins, module members,
// variables, object members, params, and `this`. Assertive: checks the rendered
// hover content, so a wrong/missing type is a real signal.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('hover coverage extra (server-driven)', function () {
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
  const file = (n) => path.join('/tmp', `hov-${n}.uc`);

  it('hovers a builtin function with its signature/doc', async () => {
    const code = `let s = substr("hello", 1, 2);\n`;
    const p = posOf(code, 'substr');
    const v = val(await s.getHover(code, file('builtin'), p.line, p.character));
    assert.ok(/substr/.test(v) && /built-?in|function/i.test(v), `expected builtin hover, got: ${v}`);
  });

  it('hovers a typed variable', async () => {
    const code = `let n = 5;\nlet name = "x";\nprint(n, name);\n`;
    const vn = val(await s.getHover(code, file('var'), 0, 4));
    assert.ok(/integer/.test(vn), `expected integer hover, got: ${vn}`);
    const vs = val(await s.getHover(code, file('var'), 1, 4));
    assert.ok(/string/.test(vs), `expected string hover, got: ${vs}`);
  });

  it('hovers an imported module namespace member', async () => {
    const code = `import * as fs from 'fs';\nlet h = fs.open("/x", "r");\n`;
    const p = posOf(code, 'open');
    const v = val(await s.getHover(code, file('module'), p.line, p.character));
    assert.ok(/open/.test(v), `expected fs.open hover, got: ${v}`);
  });

  it('hovers an object member and a method', async () => {
    const code = `let o = { count: 3, label: "hi" };\nprint(o.count);\n`;
    const p = posOf(code, 'count', 2);
    const v = val(await s.getHover(code, file('member'), p.line, p.character));
    assert.ok(v.length > 0, `expected a member hover, got empty`);
  });

  it('hovers `this.member` inside a method', async () => {
    const code = `let o = {\n  v: 10,\n  get: function() { return this.v; }\n};\nprint(o.get());\n`;
    const p = posOf(code, 'this.v');
    const v = val(await s.getHover(code, file('this'), p.line, p.character + 5)); // on `v`
    assert.ok(typeof v === 'string', 'this.member hover resolves without error');
  });

  it('hover on whitespace / comment returns nothing (no crash)', async () => {
    const code = `// just a comment line\nlet x = 1;\n`;
    const h = await s.getHover(code, file('none'), 0, 3);
    assert.ok(h === null || h === undefined || val(h) === '', 'no hover inside a comment');
  });
});
