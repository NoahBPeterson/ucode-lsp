const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// `import * as ns from './file.uc'` used to type `ns` as an opaque module-object,
// so `ns.X` member access fell through to `unknown` — making `keys(ns.X)` warn
// "Argument 1 of keys() is unknown" even though the LSP already knew the file's
// exports (for completion). The fix populates `ns`'s propertyTypes from the
// file's exports so member access resolves through the existing path.
describe('Namespace import property types', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, 'fixtures', 'nsimport');
  const file = path.join(wsRoot, 'importer.uc');
  let lspServer, getHover, getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function hoverFirstLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }

  // Hovering namespace-member tokens directly is fragile for single-char names
  // (off-by-one) — instead, assign to a local and hover the local. The local
  // gets the propagated type, so this validates the round-trip.
  it('exports propagate to the namespace member type (integer/string/array/object/function)', async function() {
    const code = [
      "import * as multi from './multi-named.uc';",     // exports A:int, B:string, f:function
      "import * as funcs from './functions-only.uc';",  // exports f1:function
      "import * as vars  from './vars-only.uc';",       // exports A:int, B:string, C:array, D:object
      "let mvA = multi.A;",
      "let mvB = multi.B;",
      "let mvF = multi.f;",
      "let fc1 = funcs.f1;",
      "let vsC = vars.C;",
      "let vsD = vars.D;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const hv = async (name, ln) => hoverFirstLine(await getHover(code, file, ln, lines[ln].indexOf(name) + 1));
    assert.ok(/integer/.test(await hv('mvA', 3)), 'multi.A should be integer');
    assert.ok(/string/.test(await hv('mvB', 4)), 'multi.B should be string');
    assert.ok(/function/.test(await hv('mvF', 5)), 'multi.f should be function');
    assert.ok(/function/.test(await hv('fc1', 6)), 'funcs.f1 should be function');
    assert.ok(/array/.test(await hv('vsC', 7)), 'vars.C should be array');
    assert.ok(/object/.test(await hv('vsD', 8)), 'vars.D should be object');
  });

  it('the user case: `keys(constants.ALFRED_TYPES)` no longer warns nullable/unknown', async function() {
    const code = [
      "import * as alfred from './alfred-like.uc';",
      "let names = keys(alfred.ALFRED_TYPES);",
      ''
    ].join('\n');
    const diags = await getDiagnostics(code, file);
    const bad = diags.find(d => d.code === 'incompatible-function-argument' || d.code === 'nullable-argument');
    assert.ok(!bad, `keys(ns.ALFRED_TYPES) must not warn, got: ${JSON.stringify(diags.map(d => d.code))}`);
  });

  it('default export becomes a `default` property on the namespace', async function() {
    const code = [
      "import * as defplus from './default-plus-named.uc';",   // export default 42 + named
      "import * as defonly from './only-default.uc';",         // export default { a:1, b:2, c:[…] }
      "let dpD = defplus.default;",
      "let doD = defonly.default;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const hv = async (name, ln) => hoverFirstLine(await getHover(code, file, ln, lines[ln].indexOf(name) + 1));
    assert.ok(/integer/.test(await hv('dpD', 2)), 'export default 42 → default: integer');
    assert.ok(/object/.test(await hv('doD', 3)), 'export default { … } → default: object');
  });

  it('a file with no exports yields no member types (no crash, no spurious diagnostics)', async function() {
    const code = "import * as empty from './empty.uc';\nlet z = empty;\n";
    const diags = await getDiagnostics(code, file);
    const bad = diags.filter(d => d.code !== 'UC1006'); // unused is fine
    assert.deepStrictEqual(bad, [], `expected only UC1006 unused, got: ${JSON.stringify(bad.map(d => d.code))}`);
  });

  it('side-effects in the imported file do not pollute the namespace shape', async function() {
    // side-effects.uc: `print(...)`, an internal `_helper()`, `let _internal=99`,
    // plus two exports (DATA: object, COUNT: int via _helper()).
    const code = [
      "import * as side from './side-effects.uc';",
      "let dvar = side.DATA;",
      "let cvar = side.COUNT;",
      "let hvar = side._helper;",   // NOT exported → should resolve to unknown
      ''
    ].join('\n');
    const lines = code.split('\n');
    const hv = async (name, ln) => hoverFirstLine(await getHover(code, file, ln, lines[ln].indexOf(name) + 1));
    assert.ok(/object/.test(await hv('dvar', 1)), 'side.DATA should be object');
    // COUNT = _helper() — function call init isn't a literal; safe fallback to unknown.
    assert.ok(!/object|function|array|integer|string/.test(await hv('hvar', 3)),
      '_helper is internal (not exported), so side._helper should NOT be typed');
  });
});
