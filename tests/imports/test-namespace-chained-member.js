const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// 0.6.78: chained namespace member access — `ns.A.B` — used to fail at the
// second hop. The LSP saw `A` as `objectName` in the member resolver, and
// since `A` isn't a top-level symbol (it's a property of `ns`), the chain
// dead-ended at "unknown" with no hover and no go-to-definition. The fix
// surfaces one-level nestedPropertyTypes on namespace-import symbols and
// teaches hover/definition + the type checker to walk that one extra hop.
describe('Chained namespace member access (ns.A.B)', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, '..', 'fixtures', 'nsimport');
  const file = path.join(wsRoot, 'importer.uc');
  let lspServer;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function hoverFirstLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }

  // alfred-like.uc: `export const ALFRED_TYPES = { HOSTINFO: 64, BAT_NEIGHBORS: 65, BANDWIDTH: 66 };`
  it('a nested constant on `ns.A.B` hovers as the property\'s inner type', async function() {
    const code = [
      "import * as alfred from './alfred-like.uc';",
      "let nestedval = alfred.ALFRED_TYPES.HOSTINFO;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    // Cursor on `nestedval` (must roundtrip the inner type through assignment)
    const col = lines[1].indexOf('nestedval') + 2;
    const h = hoverFirstLine(await lspServer.getHover(code, file, 1, col));
    assert.ok(/integer/.test(h), `nestedval should be integer (from HOSTINFO: 64), got: ${h}`);
  });

  it('cursor on the deepest member shows the property type, literal value, and chain path', async function() {
    const code = [
      "import * as alfred from './alfred-like.uc';",
      "let v = alfred.ALFRED_TYPES.HOSTINFO;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const hostInfoCol = lines[1].indexOf('HOSTINFO') + 2;
    const h = await lspServer.getHover(code, file, 1, hostInfoCol);
    const val = h?.contents?.value || '';
    assert.ok(/HOSTINFO/.test(val) && /integer/.test(val),
      `expected HOSTINFO + integer in hover, got: ${val}`);
    // Literal value (64 in alfred-like.uc) — answer to "WHAT IS THE VALUE"
    assert.ok(/=\s*64/.test(val),
      `expected literal value "= 64" in hover, got: ${val}`);
    assert.ok(/alfred\.ALFRED_TYPES/.test(val),
      `expected chain path "alfred.ALFRED_TYPES" in hover, got: ${val}`);
  });

  it('go-to-definition on the deepest member lands inside the imported file', async function() {
    const code = [
      "import * as alfred from './alfred-like.uc';",
      "let v = alfred.ALFRED_TYPES.HOSTINFO;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const hostInfoCol = lines[1].indexOf('HOSTINFO') + 2;
    const def = await lspServer.getDefinition(code, file, 1, hostInfoCol);
    assert.ok(def, 'expected a definition for HOSTINFO');
    const target = Array.isArray(def) ? def[0] : def;
    assert.ok(target.uri.endsWith('alfred-like.uc'),
      `expected target in alfred-like.uc, got: ${target.uri}`);
    // The location should point at the `HOSTINFO:` key inside the object literal —
    // not at the start of the file (the failure mode the user reported).
    assert.ok(target.range.start.line > 0,
      `expected non-zero line for HOSTINFO key location, got: ${JSON.stringify(target.range)}`);
  });

  it('a non-existent nested member yields no hover (graceful miss)', async function() {
    const code = [
      "import * as alfred from './alfred-like.uc';",
      "let v = alfred.ALFRED_TYPES.NOPE;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const nopeCol = lines[1].indexOf('NOPE') + 2;
    const h = await lspServer.getHover(code, file, 1, nopeCol);
    const val = h?.contents?.value || '';
    // Should NOT claim it's a property on alfred.ALFRED_TYPES — that's the
    // success path we don't want to misfire on misses.
    assert.ok(!/integer|string|object/.test(val) || !/alfred\.ALFRED_TYPES/.test(val),
      `unexpected hover for non-existent NOPE: ${val}`);
  });
});
