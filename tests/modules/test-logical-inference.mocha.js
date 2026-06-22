// End-to-end logical-operator type inference (||, &&), driven through the real
// LSP server. ucode's || / && return one of the *operands* (not a boolean), so
// the result type depends on the left operand's truthiness:
//   - definitely truthy (array, object, function, regex) → returns left
//   - definitely falsy  (null)                            → returns right
//   - could be either   (int, double, string, bool)       → union(left, right)
// Truthiness verified against /usr/local/bin/ucode (arrays/objects are truthy
// even when empty; only null is always falsy).
//
// Replaces the orphaned, never-registered test-logical-type-inference.js (which
// couldn't run and tested now-deleted scalar helpers). Guards the fix where
// `array<T>` / object / module operands weren't recognised as always-truthy
// (isDefinitelyTruthy compared the bare enum, missing the refined forms).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Logical operator type inference (e2e, vs ucode truthiness)', function () {
  this.timeout(20000);

  let getHover;
  let root;

  // Typed operands. `a` is array<integer> (a refined ArrayType, not the bare
  // enum — the case the truthiness fix is about); `u` is a union int|null;
  // `m1`/`m2` are the same module type (uci.cursor | null).
  const prelude =
    "import { cursor } from 'uci';\n" +
    'let i = 1;\n' +
    'let s = "x";\n' +
    'let n = null;\n' +
    'let a = [1];\n' +
    'let o = { x: 1 };\n' +
    'let u = i > 0 ? 1 : null;\n' +
    'let m1 = cursor();\n' +
    'let m2 = cursor();\n';

  function clickAt(code, anchor) {
    const idx = code.indexOf(anchor);
    if (idx < 0) throw new Error(`anchor not found: ${anchor}`);
    const pre = code.slice(0, idx);
    return { line: (pre.match(/\n/g) || []).length, character: idx - (pre.lastIndexOf('\n') + 1) };
  }
  function hoverText(h) {
    if (h == null) return null;
    return typeof h.contents === 'string' ? h.contents : (h.contents && h.contents.value) || '';
  }
  // The variable hover renders the type in backticks: "(variable) **r0**: `string`".
  // Extract it so we can compare the WHOLE type exactly — a substring check would
  // let the buggy `array<integer> | string` pass an `array<integer>` expectation.
  function hoverType(h) {
    const t = hoverText(h);
    if (!t) return null;
    const m = t.match(/`([^`]+)`/);
    return m ? m[1].trim() : t.trim();
  }

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getHover = server.getHover;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-logic-'));
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  // [expression, exact expected type]
  const cases = [
    // OR (||)
    ['n || s', 'string'],                  // null falsy → right
    ['a || s', 'array<integer>'],          // array always truthy → left (NOT a union)
    ['a || i', 'array<integer>'],          // array truthy regardless of right type
    ['o || i', 'object'],                  // object always truthy → left
    ['i || s', 'integer | string'],        // int can be either → union
    ['u || s', 'integer | string'],        // (int|null) || s: int→int|s, null→s
    ['m1 || m2', 'uci.cursor | null'],     // same module type → short-circuit to left

    // AND (&&)
    ['n && s', 'null'],                    // null falsy → left
    ['a && s', 'string'],                  // array truthy → right (NOT a union)
    ['o && s', 'string'],                  // object truthy → right
    ['i && s', 'integer | string'],        // int either → union
    ['u && s', 'integer | string | null'], // (int|null) && s: int→int|s, null→null
  ];

  let code = prelude;
  cases.forEach(([expr], idx) => { code += `let r${idx} = ${expr};\n`; });

  let fp;
  before(function () {
    fp = path.join(root, 'logic.uc');
    fs.writeFileSync(fp, code);
  });

  cases.forEach(([expr, expected], idx) => {
    it(`${expr} → ${expected}`, async () => {
      const p = clickAt(code, `r${idx} =`);
      const h = await getHover(code, fp, p.line, p.character);
      const actual = hoverType(h);
      assert.ok(actual, `expected a hover for \`${expr}\`, got null`);
      assert.strictEqual(actual, expected, `\`${expr}\` should infer exactly "${expected}"`);
    });
  });
});
