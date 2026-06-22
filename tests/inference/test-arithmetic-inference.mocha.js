// End-to-end arithmetic type inference, driven through the real LSP server.
// Each result type is pinned against the ucode runtime oracle (`type(expr)` in
// /usr/local/bin/ucode). Replaces the old orphaned, never-run unit test that
// asserted internal-API return values (and had stale expectations).
//
// Guards the divide/modulo-by-null fix: a null divisor coerces to 0, so the
// operation is always division-by-zero → Infinity/NaN, which ucode types as
// `double` (previously mis-reported as `integer`).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Arithmetic type inference (e2e, vs ucode oracle)', function () {
  this.timeout(20000);

  let getHover;
  let root;

  // Typed operands. The result of `<name> = <expr>` is hovered to read its type.
  const prelude =
    'let i = 1;\n' +
    'let d = 1.5;\n' +
    'let s = "a";\n' +
    'let b = true;\n' +
    'let n = null;\n' +
    'let a = [1];\n' +
    'let o = { x: 1 };\n' +
    'let fn = function() {};\n' +
    'let rx = /x/;\n';

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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-arith-'));
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  // [expression, expected ucode type] — every expectation matches `type(expr)`
  // in the real interpreter.
  const cases = [
    // Addition: any string operand → concatenation (string).
    ['s + i', 'string'],   // string left
    ['i + s', 'string'],   // string right
    ['a + s', 'string'],   // non-numeric + string still concatenates
    // Addition: numeric promotion + integer coercion.
    ['i + d', 'double'],    // double promotion
    ['i + i', 'integer'],   // pure integer
    ['i + b', 'integer'],   // bool coerces to 0/1
    ['b + n', 'integer'],   // bool + null both coerce to int
    ['n + n', 'integer'],   // null + null → 0 + 0
    // Addition: non-numeric, non-string operands → NaN → double.
    ['a + i', 'double'],    // array
    ['i + o', 'double'],    // object
    ['fn + i', 'double'],   // function
    ['rx + i', 'double'],   // regex

    // Subtraction / multiplication: numeric path, no string concat.
    ['i - i', 'integer'],
    ['i - d', 'double'],
    ['s - i', 'double'],    // string can't convert → NaN
    ['i - n', 'integer'],   // null right is fine for - (coerces to 0)
    ['n - n', 'integer'],
    ['a - i', 'double'],
    ['b * b', 'integer'],
    ['fn * i', 'double'],
    ['rx * i', 'double'],
    ['o * i', 'double'],

    // Division: divide-by-null → double (the fix). Left-null is still fine.
    ['i / i', 'integer'],
    ['d / i', 'double'],
    ['i / n', 'double'],    // ★ fix: int / null
    ['b / n', 'double'],    // ★ fix: bool / null
    ['n / n', 'double'],    // ★ fix: null / null
    ['n / i', 'integer'],   // null / int → 0 / 1 → 0
    ['s / i', 'double'],
    ['a / i', 'double'],

    // Modulo: same divide-by-null rule.
    ['i % i', 'integer'],
    ['i % n', 'double'],    // ★ fix: int % null
    ['n % i', 'integer'],   // null % int → 0 % 1 → 0
    ['s % i', 'double'],

    // Exponentiation: numeric promotion like -/*, NOT the divide-by-null rule
    // (typeChecker previously had no `**` case → inferred unknown).
    ['i ** i', 'integer'],  // 2 ** 3 → int (common case)
    ['i ** d', 'double'],   // double exponent → double
    ['i ** n', 'integer'],  // 2 ** null → 2 ** 0 → 1 (int) — null is NOT div-by-zero here
    ['s ** i', 'double'],   // non-numeric base → NaN → double
  ];

  // One document holds every case (result vars r0..rN); each `it` hovers one.
  let code = prelude;
  cases.forEach(([expr], idx) => { code += `let r${idx} = ${expr};\n`; });

  let fp;
  before(function () {
    fp = path.join(root, 'arith.uc');
    fs.writeFileSync(fp, code);
  });

  cases.forEach(([expr, expected], idx) => {
    it(`${expr} → ${expected}`, async () => {
      const p = clickAt(code, `r${idx} =`);
      const h = await getHover(code, fp, p.line, p.character);
      const text = hoverText(h);
      assert.ok(text, `expected a hover for \`${expr}\`, got null`);
      assert.ok(
        text.includes(expected),
        `\`${expr}\` should infer ${expected}, got: ${text.replace(/\n/g, ' ').slice(0, 80)}`
      );
    });
  });

  // Unknown operands propagate as `unknown` (don't guess). Union operands are
  // distributed over their members and collapsed — `(integer|string) + 1` is
  // `integer | string` (int+1=int, string+1=string), matching the set of values
  // the runtime can actually produce. `x` is an untyped parameter (unknown);
  // `t` is a union from a mixed-type ternary.
  const fbCode =
    'function f(x, c) {\n' +
    '  let t = c ? 1 : "s";\n' +
    '  let fu1 = x + 1;\n' +
    '  let fu2 = x - 1;\n' +
    '  let fu3 = x + "s";\n' +
    '  let fu4 = x / null;\n' +
    '  let fn1 = t + 1;\n' +
    '  let fn2 = t - 1;\n' +
    '  let fn3 = t + "x";\n' +
    '  let fn4 = t / null;\n' +
    '  return [fu1, fu2, fu3, fu4, fn1, fn2, fn3, fn4];\n' +
    '}\n';
  const fbCases = [
    ['fu1', 'unknown + int', 'unknown'],            // Rule 4 via addition's numeric path
    ['fu2', 'unknown - int', 'unknown'],            // Rule 4
    ['fu3', 'unknown + string', 'string'],          // addition's string-concat rule
    ['fu4', 'unknown / null', 'double'],            // divide-by-null, left operand ignored
    ['fn1', '(int|string) + int', 'integer | string'], // distributed: int+int=int, str+int=str
    ['fn2', '(int|string) - int', 'integer | double'], // int-int=int, str-int=double(NaN)
    ['fn3', '(int|string) + string', 'string'],     // both members concatenate
    ['fn4', '(int|string) / null', 'double'],       // both members divide-by-null
  ];

  let fbFp;
  before(function () {
    fbFp = path.join(root, 'arith-fallback.uc');
    fs.writeFileSync(fbFp, fbCode);
  });

  fbCases.forEach(([name, expr, expected]) => {
    it(`${expr} → ${expected} (inference fallback)`, async () => {
      const p = clickAt(fbCode, `${name} =`);
      const h = await getHover(fbCode, fbFp, p.line, p.character);
      const text = hoverText(h);
      assert.ok(text, `expected a hover for \`${expr}\`, got null`);
      assert.ok(
        text.includes(expected),
        `\`${expr}\` should infer ${expected}, got: ${text.replace(/\n/g, ' ').slice(0, 80)}`
      );
    });
  });

  // Unions must reach arithmetic from EVERY source, not just direct ternaries:
  // a function return (via a variable AND as a direct call operand) and an array
  // element. Exact match (extract the backtick type) so a stray `unknown` — the
  // pre-fix behaviour for these sources — can't pass.
  const srcCode =
    'function ff(c) { return c ? 1 : "s"; }\n' + // returns integer | string
    'let arr = [1, 2];\n' +
    'let sv = ff(true) + 1;\n' +   // call return → var-free operand
    'let svv = ff(true);\n' +
    'let sv2 = svv - 1;\n' +       // call return → through a variable
    'let sc = ff(1) + ff(0);\n' +  // union on BOTH operands (two calls)
    'let se = arr[0] - 1;\n';      // array element (integer | null)
  const srcCases = [
    ['sv', 'f() + int', 'integer | string'],       // int+1=int, str+1=str
    ['sv2', 'v - int (v = f())', 'integer | double'], // int-1=int, str-1=double
    ['sc', 'f() + f()', 'integer | string'],       // union × union, distributed
    ['se', 'arr[0] - int', 'integer'],             // (int|null)-1 → int both ways
  ];

  const srcType = (h) => {
    const t = hoverText(h);
    if (!t) return null;
    const m = t.match(/`([^`]+)`/);
    return m ? m[1].trim() : t.trim();
  };

  let srcFp;
  before(function () {
    srcFp = path.join(root, 'arith-sources.uc');
    fs.writeFileSync(srcFp, srcCode);
  });

  srcCases.forEach(([name, expr, expected]) => {
    it(`${expr} → ${expected} (union source)`, async () => {
      const p = clickAt(srcCode, `${name} =`);
      const h = await getHover(srcCode, srcFp, p.line, p.character);
      const actual = srcType(h);
      assert.ok(actual, `expected a hover for \`${expr}\`, got null`);
      assert.strictEqual(actual, expected, `\`${expr}\` should infer exactly "${expected}"`);
    });
  });

  // A string coerces to a number in non-`+` arithmetic. A string LITERAL is
  // classified by its contents (ucode's number cast); a string VARIABLE has an
  // unknown value, so it's `integer | double`. Exact match. Verified against
  // /usr/local/bin/ucode (e.g. type(-"42")=int, type(-"42.5")=double).
  const strCode =
    'let sv = "unknown";\n' +
    'let c1 = -"42";\n' +       // integer literal string → integer
    'let c2 = -"42.5";\n' +     // float literal string → double
    'let c3 = -"0x1f";\n' +     // hex literal string → integer
    'let c4 = -"abc";\n' +      // non-numeric → NaN → double
    'let c5 = "42" - 1;\n' +    // binary, integer string → integer
    'let c6 = "42.5" * 2;\n' +  // binary, float string → double
    'let c7 = sv - 1;\n' +      // unknown string variable → integer | double
    'let c8 = "42" + 1;\n';     // `+` is concatenation, not coercion → string
  const strCases = [
    ['c1', '-"42"', 'integer'],
    ['c2', '-"42.5"', 'double'],
    ['c3', '-"0x1f"', 'integer'],
    ['c4', '-"abc"', 'double'],
    ['c5', '"42" - 1', 'integer'],
    ['c6', '"42.5" * 2', 'double'],
    ['c7', 'strVar - 1', 'integer | double'],
    ['c8', '"42" + 1', 'string'],
  ];

  let strFp;
  before(function () {
    strFp = path.join(root, 'arith-strings.uc');
    fs.writeFileSync(strFp, strCode);
  });

  strCases.forEach(([name, expr, expected]) => {
    it(`${expr} → ${expected} (string coercion)`, async () => {
      const p = clickAt(strCode, `${name} =`);
      const h = await getHover(strCode, strFp, p.line, p.character);
      const actual = srcType(h);
      assert.ok(actual, `expected a hover for \`${expr}\`, got null`);
      assert.strictEqual(actual, expected, `\`${expr}\` should infer exactly "${expected}"`);
    });
  });
});
