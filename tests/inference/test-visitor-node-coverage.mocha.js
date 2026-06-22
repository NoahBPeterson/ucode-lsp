// SERVER-DRIVEN coverage for analysis/visitor.ts — drives a wide spread of AST node
// types through the analyzer (via getDiagnostics) so the visitor's dispatch handles
// each kind inside the bundle: template literals, spread, delete, this, conditional,
// optional chaining, nullish, unary/update, regex, in-operator, imports/exports, etc.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('AST visitor node coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const file = (n) => path.join('/tmp', `vis-${n}.uc`);
  const parserErrors = (ds) => ds.filter(d => d.severity === 1 && d.source === 'ucode-parser');

  it('expression node variety parses and visits', async () => {
    const code = `
let arr = [1, 2, 3];
let obj = { a: 1, "b-c": 2, [arr[0]]: 3 };
let spreadArr = [...arr, 4];
let spreadObj = { ...obj, d: 4 };
let cond = arr[0] > 0 ? "pos" : "nonpos";
let logical = obj.a && (obj.a || arr[1]);
let nullish = obj.missing ?? "default";
let unary = !cond + -arr[0] + ~arr[1];
let i = 0; i++; --i; i += 2; i *= 3;
let tmpl = \`val is \${arr[0]} and \${obj.a}\`;
let re = match("abc123", /[0-9]+/);
let has = "a" in obj;
let comma = (arr[0], arr[1], arr[2]);
delete obj.a;
print(arr, obj, spreadArr, spreadObj, cond, logical, nullish, unary, i, tmpl, re, has, comma);
`;
    const ds = await s.getDiagnostics(code, file('expr'));
    assert.strictEqual(parserErrors(ds).length, 0, `unexpected parser errors: ${JSON.stringify(parserErrors(ds).map(e => e.message))}`);
  });

  it('this, methods, arrow functions, optional chaining', async () => {
    const code = `
let o = {
  val: 10,
  get: function() { return this.val; },
  inc: () => 1,
  deep: { nested: { fn: function() { return 1; } } }
};
let chained = o?.deep?.nested?.fn();
let arrowChain = (x) => (y) => x + y;
print(o.get(), chained, arrowChain(1)(2));
`;
    const ds = await s.getDiagnostics(code, file('this'));
    assert.strictEqual(parserErrors(ds).length, 0, `unexpected parser errors: ${JSON.stringify(parserErrors(ds).map(e => e.message))}`);
  });

  it('imports (default / named / namespace) and exports', async () => {
    const code = `
import { open } from 'fs';
import * as math from 'math';
const LOCAL = 1;
export const SHARED = LOCAL + 1;
export function helper() { return SHARED; }
export default { helper };
print(open, math.abs(-1));
`;
    const ds = await s.getDiagnostics(code, file('imports'));
    // imports/exports may produce semantic notes, but must not crash or hard-parse-error
    assert.strictEqual(parserErrors(ds).length, 0);
  });

  it('empty statements and nested function expressions', async () => {
    const code = `;;\nlet f = function() { ;; return function() { return 1; }; };\nprint(f()());\n;`;
    const ds = await s.getDiagnostics(code, file('empty'));
    assert.ok(Array.isArray(ds));
  });

  it('hover over diverse nodes drives type resolution', async () => {
    const code = `let nums = [1, 2, 3];\nlet first = nums[0];\nlet obj = { x: "hi" };\nprint(first, obj.x);\n`;
    const h1 = await s.getHover(code, file('hover'), 1, 4); // first
    const h2 = await s.getHover(code, file('hover'), 2, 4); // obj
    assert.ok(h1 !== undefined && h2 !== undefined, 'hover requests resolve (or return null) without error');
  });
});
