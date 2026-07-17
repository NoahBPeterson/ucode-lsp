// Exhaustive comparison-classification matrix for the type-driven equality lint.
//
// Every ordered type pair × {==, ===} (and spot != / !== mirrors), var-vs-var,
// classified as silent / UC2015 (coercing) / UC2009 (impossible). The EXPECTED
// column is hand-derived from ucode's runtime semantics (ucode/types.c ucv_compare),
// independently of the analyzer, so agreement is a real check:
//   - ===  : true only between the SAME type      → different types = impossible
//   - ==   : coerces via ucv_to_number:
//              same base                → ok
//              int/double vs int/double → ok (correct numeric compare)
//              scalar cross (num/str/bool) → coercing (possible, but !== ===)
//              reference (obj/arr/fn/regex) vs a different base → impossible (→ NaN)
// null is intentionally OUT of scope (owned by the null-safety engine).

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// A typed value literal for each base (used as `let a = <expr>`).
const T = {
  int: '5', double: '1.5', string: '"s"', bool: 'true',
  object: '{a:1}', array: '["a"]', func: 'function(){}', regex: '/re/',
};
const KEYS = Object.keys(T);
const isNum = k => k === 'int' || k === 'double';
const isRef = k => k === 'object' || k === 'array' || k === 'func' || k === 'regex';

// Hand-derived expected classification from ucv_compare semantics. Operands here are
// VARIABLES (`let a = <expr>; a <op> b`), so two same-type references may alias → they are
// a `reference` comparison (UC2016), NOT provably-false. `==` and `===` are IDENTICAL for
// references (both pointer-compare — runtime-verified), so BOTH warn. (Fresh object/array
// LITERALS in operand position are a separate always-false case, covered below.)
function expected(op, a, b) {
  const strict = op === '===' || op === '!==';
  if (isRef(a) && isRef(b)) return a === b ? 'reference' : 'impossible'; // same ref type → reference (may alias); different → always false — for BOTH == and ===
  if (isRef(a) || isRef(b)) return 'impossible';   // a reference vs a scalar → never equal (both == and ===)
  // both scalar:
  if (a === b) return 'ok';                         // same scalar base
  if (strict) return 'impossible';                 // strict, distinct scalar types → always false
  if (isNum(a) && isNum(b)) return 'ok';            // int vs double — correct numeric compare
  return 'coercing';                               // scalar cross (num/str/bool) — coerces, diverges from ===
}

async function classify(op, a, b) {
  const code = `let a = ${T[a]};\nlet b = ${T[b]};\nlet r = (a ${op} b);\n`;
  const ds = await server.getDiagnostics(code, `/tmp/eqm-${n++}.uc`);
  const has2009 = ds.some(d => d.code === 'UC2009');
  const has2015 = ds.some(d => d.code === 'UC2015');
  const has2016 = ds.some(d => d.code === 'UC2016');
  if (has2009 && has2015) return 'BOTH';
  if (has2009) return 'impossible';
  if (has2015) return 'coercing';
  if (has2016) return 'reference';
  return 'ok';
}

for (const op of ['==', '===']) {
  for (const a of KEYS) {
    for (const b of KEYS) {
      const exp = expected(op, a, b);
      test(`${a} ${op} ${b} → ${exp}`, async () => {
        expect(await classify(op, a, b)).toBe(exp);
      });
    }
  }
}

// != / !== mirror the same classification code (only the "always" message flips).
for (const [a, b] of [['object','array'], ['int','string'], ['int','double'], ['bool','string'], ['object','object']]) {
  for (const op of ['!=', '!==']) {
    const exp = expected(op, a, b);
    test(`${a} ${op} ${b} → ${exp} (negated mirror)`, async () => {
      expect(await classify(op, a, b)).toBe(exp);
    });
  }
}
