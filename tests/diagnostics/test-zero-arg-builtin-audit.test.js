// Zero-argument builtin audit (Task #1): every core builtin that ucode ACCEPTS with no args
// returns a deterministic dead value (verified against ucode/lib.c). Such a call is:
//   - flagged as a strict-gated UC2012 useless-call diagnostic (warning normally, error under
//     'use strict') — NOT a UC2003 arity error, because ucode runs it without error, and
//   - narrowed to the EXACT zero-arg return type (mostly null), not the general signature type.
//
// Builtins that THROW a runtime exception on zero args (json/include/system/render) are genuinely
// invalid and stay a hard error in both modes.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getDiagnostics, getHover;
let n = 0;
const fp = () => `/tmp/zeroarg-${n++}.uc`;
const SEV = { ERROR: 1, WARNING: 2 };

// expected zero-arg return type per builtin (from lib.c, all args NULL)
const EXPECTED_TYPE = {
  // → null
  filter: 'null', index: 'null', rindex: 'null', join: 'null', keys: 'null', length: 'null',
  ltrim: 'null', rtrim: 'null', trim: 'null', map: 'null', pop: 'null', push: 'null',
  shift: 'null', unshift: 'null', reverse: 'null', sort: 'null', slice: 'null', split: 'null',
  substr: 'null', values: 'null', match: 'null', replace: 'null', uniq: 'null', iptoarr: 'null',
  arrtoip: 'null', b64enc: 'null', b64dec: 'null', hexdec: 'null', hexenc: 'null', proto: 'null',
  wildcard: 'null', timelocal: 'null', timegm: 'null', call: 'null', signal: 'null',
  require: 'null', loadfile: 'null',
  // → non-null dead value
  int: 'integer', hex: 'double', uc: 'string', lc: 'string',
  exists: 'boolean', sleep: 'boolean', regexp: 'regexp', loadstring: 'function',
};
const THROWS = ['json', 'include', 'system', 'render'];

async function diagsFor(code, ucCode) {
  const d = (await getDiagnostics(code, fp())) || [];
  return d.filter((x) => x.code === ucCode);
}
async function hoverType(expr) {
  const h = await getHover(`let x = ${expr};\n`, fp(), 0, 4);
  const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  return t ? (t.replace(/\n/g, ' ').match(/`[^`]*`/)?.[0]?.replace(/`/g, '') || '?') : '(none)';
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getHover = server.getHover;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('zero-arg builtins: useless-call diagnostic + exact return-type narrowing', () => {
  for (const [fn, expectedType] of Object.entries(EXPECTED_TYPE)) {
    test(`${fn}() → UC2012 warn (non-strict), error (strict), type ${expectedType}`, async () => {
      // non-strict: a single UC2012 warning, no UC2003 arity error
      const warn = await diagsFor(`${fn}();\n`, 'UC2012');
      expect(warn.length).toBe(1);
      expect(warn[0].severity).toBe(SEV.WARNING);
      expect((await diagsFor(`${fn}();\n`, 'UC2003')).length).toBe(0);

      // strict: the same useless call escalates to an error
      const strict = await diagsFor(`'use strict';\n${fn}();\n`, 'UC2012');
      expect(strict.length).toBe(1);
      expect(strict[0].severity).toBe(SEV.ERROR);

      // the call's return type is narrowed to the exact zero-arg result
      expect(await hoverType(`${fn}()`)).toBe(expectedType);
    });
  }

  // Builtins that throw on zero args are invalid ucode → hard error in BOTH modes, not a warning.
  for (const fn of THROWS) {
    test(`${fn}() throws on zero args → stays a hard error, no UC2012`, async () => {
      const err = await diagsFor(`${fn}();\n`, 'UC2003');
      expect(err.length).toBe(1);
      expect(err[0].severity).toBe(SEV.ERROR);
      expect((await diagsFor(`${fn}();\n`, 'UC2012')).length).toBe(0);
    });
  }

  // A handful of representative non-zero-arg calls stay clean (no false useless-call warning).
  test('non-zero-arg calls are not flagged as useless', async () => {
    for (const call of ['split("a,b", ",")', 'keys({a:1})', 'length("hi")', 'uc("x")', 'b64enc("x")']) {
      expect((await diagsFor(`${call};\n`, 'UC2012')).length).toBe(0);
    }
  });
});
