// Comprehensive end-to-end hover tests (textDocument/hover) driving the real
// server. Locks in hover behaviour across the common scenarios and guards the
// namespace-member-of-a-user-module fix (`import * as U from './m'; U.fn()`).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Hover (comprehensive e2e)', function () {
  this.timeout(20000);

  let getHover;
  let root;

  // LSP position at the first char of the identifier `anchor` begins with.
  function clickAt(code, anchor) {
    const i = code.indexOf(anchor);
    if (i < 0) throw new Error(`anchor not found: ${anchor}`);
    const pre = code.slice(0, i);
    return { line: (pre.match(/\n/g) || []).length, character: i - (pre.lastIndexOf('\n') + 1) };
  }

  function hoverText(h) {
    if (h == null) return null;
    return typeof h.contents === 'string' ? h.contents : (h.contents && h.contents.value) || '';
  }

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getHover = server.getHover;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-hover-'));
    fs.writeFileSync(path.join(root, 'lib.uc'), 'export function libFn(a) {\n  return a;\n};\n');
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  // [label, code, click anchor, expected substrings (all must be present)]
  const cases = [
    ['local variable (integer)', "let count = 5;\nprint(count);\n", 'count)', ['count', 'integer']],
    ['local variable (string)', "let name = 'x';\nprint(name);\n", 'name)', ['string']],
    ['parameter via JSDoc', "/** @param {string} s */\nfunction f(s) {\n  return s;\n}\n", 's;\n', ['parameter', 'string']],
    ['function declaration', "function add(a, b) {\n  return a + b;\n}\nadd(1, 2);\n", 'add(a', ['function', 'add']],
    ['function call', "function add(a, b) {\n  return a + b;\n}\nadd(1, 2);\n", 'add(1', ['add']],
    ['builtin function (length)', "let n = length([1, 2]);\n", 'length(', ['built-in']],
    ['builtin function (printf)', "printf('x');\n", 'printf(', ['built-in']],
    ['printf format specifier', 'printf("%s", "x");\n', 's"', ['Format specifier']],
    ['module function (fs.open)', "import { open } from 'fs';\nopen('/x', 'r');\n", 'open(', ['open(']],
    ['known-object method (uci)', "import { cursor } from 'uci';\nlet ctx = cursor();\nctx.get('a', 'b');\n", 'get(', ['get(']],
    ['narrowed type (array)', "function f(x) {\n  if (type(x) == 'array') {\n    return x[0];\n  }\n}\n", 'x[0]', ['array']],
    ['imported user symbol', "import { libFn } from './lib.uc';\nlibFn(1);\n", 'libFn(1', ['libFn']],
    ['namespace import identifier', "import * as U from './lib.uc';\nU.libFn(2);\n", 'U.libFn', ['module']],
    ['namespace member (user module)', "import * as U from './lib.uc';\nU.libFn(2);\n", 'libFn(2', ['function', 'libFn']],
    ['this.property', "let o = {\n  v: 5,\n  m: function() { return this.v; }\n};\n", 'v; }', ['integer']],
    ['object property access', "let o = { v: 5 };\nlet z = o.v;\n", 'v;', ['integer']],
    ['rest parameter', "function f(...args) {\n  return args;\n}\n", 'args;', ['array']],
  ];

  for (const [label, code, anchor, expected] of cases) {
    it(`hovers: ${label}`, async () => {
      const fp = path.join(root, 'app.uc');
      fs.writeFileSync(fp, code);
      const p = clickAt(code, anchor);
      const h = await getHover(code, fp, p.line, p.character);
      const text = hoverText(h);
      assert.ok(text, `expected a hover for "${label}", got null`);
      for (const sub of expected) {
        assert.ok(text.includes(sub), `"${label}": hover should include "${sub}", got: ${text.replace(/\n/g, ' ').slice(0, 100)}`);
      }
    });
  }
});
