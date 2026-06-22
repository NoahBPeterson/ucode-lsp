const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

// 0.6.80 — Scope A (literal/constant key match) + Scope B (key-of provenance).
//
// We type `obj[key]` only when we can PROVE `key` is one of `obj`'s known
// keys. Two ways to prove it:
//   A) the key is a literal/constant we can statically resolve and it matches
//      one of obj's propertyTypes entries.
//   B) the key carries `keysOfSymbol` provenance — it came from `keys(obj)`,
//      from iterating `obj` via for-in, or was derived from such a value by
//      array indexing or a direct identifier alias.
//
// Cases we EXPLICITLY don't cover (function-call keys, arithmetic keys, key
// reassignment) are exercised as sanity tests — they must degrade to
// `unknown`, not lie. int() preservation is intentionally NOT implemented.
describe('Computed object access typing (Scope A + B)', function() {
  this.timeout(20000);

  const wsRoot = '/tmp/test-computed-key-typing';
  const libDir = path.join(wsRoot, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(path.join(libDir, 'constants.uc'), [
    "'use strict';",
    "export const ALFRED_TYPES = {",
    "    HOSTINFO: 64,",
    "    NEIGHBORS: 65,",
    "    BANDWIDTH: 66,",
    "};",
    ''
  ].join('\n'));

  const file = path.join(wsRoot, 'main.uc');
  let lspServer;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function firstHoverLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }

  async function hoverVar(code, varName) {
    const lines = code.split('\n');
    const lineIdx = lines.findIndex(l => l.includes('let ' + varName) || l.includes('const ' + varName));
    if (lineIdx < 0) throw new Error(`var ${varName} not declared`);
    const col = lines[lineIdx].indexOf(varName) + 2;
    return firstHoverLine(await lspServer.getHover(code, file, lineIdx, col));
  }

  // ---------------------------------------------------------------------- A

  describe('Scope A: literal/constant key match', function() {
    it('literal integer key matches a property', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { 64: gen_a };",
        "let result = m[64];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function, got: ${h}`);
    });

    it('literal string key matches a property', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { foo: gen_a };",
        "let result = m['foo'];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function, got: ${h}`);
    });

    it('namespace-nested constant key (user case) — integer key, propertyTypes populated from computed key', async function() {
      const code = [
        "'use strict';",
        "import * as constants from './lib/constants.uc';",
        "function gen_host() { return 'host'; }",
        "const generators = {",
        "    [constants.ALFRED_TYPES.HOSTINFO]: gen_host,",
        "};",
        "let result = generators[constants.ALFRED_TYPES.HOSTINFO];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function, got: ${h}`);
    });

    it('literal-int direct access on the same namespace-keyed object', async function() {
      // After Scope A populates propertyTypes with key "64", literal 64 access works.
      const code = [
        "'use strict';",
        "import * as constants from './lib/constants.uc';",
        "function gen_host() { return 'host'; }",
        "const generators = {",
        "    [constants.ALFRED_TYPES.HOSTINFO]: gen_host,",
        "};",
        "let result = generators[64];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function, got: ${h}`);
    });

    it('const-bound literal identifier as key', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const KEY = 'foo';",
        "const m = { foo: gen_a };",
        "let result = m[KEY];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function, got: ${h}`);
    });

    // -- Sanity: cases we explicitly don't cover

    it('SANITY: function-call key → unknown', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "function get_key() { return 'foo'; }",
        "const m = { foo: gen_a };",
        "let result = m[get_key()];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/unknown/.test(h), `expected unknown (no static folding for fn returns), got: ${h}`);
    });

    it('SANITY: arithmetic key → unknown', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { 65: gen_a };",
        "let i = 64;",
        "let result = m[i + 1];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/unknown/.test(h), `expected unknown (no arithmetic folding), got: ${h}`);
    });

    it('SANITY: literal NOT in propertyTypes → unknown (no false null claim)', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { foo: gen_a };",
        "let result = m['bar'];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/unknown/.test(h), `expected unknown (we can't prove key is missing post-mutation), got: ${h}`);
    });
  });

  // ---------------------------------------------------------------------- B

  describe('Scope B: keys-of provenance', function() {
    it('for (let k in obj) — k is a key, obj[k] returns value-union', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "function gen_b() { return 'b'; }",
        "const m = { a: gen_a, b: gen_b };",
        "for (let k in m) {",
        "    let result = m[k];",
        "}",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function (homogeneous values), got: ${h}`);
    });

    it('for (let k in keys(obj)) — same coverage', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "function gen_b() { return 'b'; }",
        "const m = { a: gen_a, b: gen_b };",
        "for (let k in keys(m)) {",
        "    let result = m[k];",
        "}",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function, got: ${h}`);
    });

    it('keys() → indexed array carries the tag through array access', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { a: gen_a };",
        "const ks = keys(m);",
        "let kvar = ks[0];",
        "let result = m[kvar];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function (tag survives ks[0]), got: ${h}`);
    });

    it('heterogeneous values → real union, not unknown', async function() {
      const code = [
        "'use strict';",
        "const m = { x: 1, y: 'hello', z: true };",
        "for (let k in m) {",
        "    let result = m[k];",
        "}",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      // Should mention integer AND string (the union)
      assert.ok(/integer/.test(h) && /string/.test(h),
        `expected integer|string|... union, got: ${h}`);
    });

    it('alias of tagged var keeps the tag', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { a: gen_a };",
        "const ks = keys(m);",
        "const ks2 = ks;",
        "let kvar = ks2[0];",
        "let result = m[kvar];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/function/.test(h), `expected function (alias preserves tag), got: ${h}`);
    });

    // -- Sanity: cases we explicitly don't cover

    it('SANITY: empty object → unknown (no value types to union)', async function() {
      const code = [
        "'use strict';",
        "const m = {};",
        "for (let k in m) {",
        "    let result = m[k];",
        "}",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/unknown/.test(h), `expected unknown, got: ${h}`);
    });

    it('SANITY: untracked variable → unknown', async function() {
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { a: gen_a };",
        "function get_k() { return 'mystery'; }",
        "let kvar = get_k();",
        "let result = m[kvar];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/unknown/.test(h), `expected unknown (key from function call has no static value), got: ${h}`);
    });

    it('SANITY: int(x) does NOT preserve keys-of provenance', async function() {
      // ucode's runtime coercion makes int(keys(obj)[i]) hit obj's stringified
      // integer keys, but we explicitly DON'T track this — int() generally
      // discards key-existence proofs. Stays unknown by design.
      const code = [
        "'use strict';",
        "function gen_a() { return 'a'; }",
        "const m = { 64: gen_a };",
        "const ks = keys(m);",
        "let kstr = ks[0];",
        "let kint = int(kstr);",
        "let result = m[kint];",
        ''
      ].join('\n');
      const h = await hoverVar(code, 'result');
      assert.ok(/unknown/.test(h), `int() should drop keys-of tag — got: ${h}`);
    });
  });
});
