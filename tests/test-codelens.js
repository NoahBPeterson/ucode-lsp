const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// E2e plumbing for the function-history CodeLens. We assert the wiring — one
// lens per function at the right anchor line, and that resolve attaches a
// command with a non-empty title — WITHOUT asserting git commit content (which
// is environment-dependent; the fixture isn't a committed file, so the title is
// the muted "No git history").
describe('Function-history CodeLens', function() {
  this.timeout(15000);

  let lspServer, getCodeLens, resolveCodeLens, initResult;

  // Function DECLARATIONS get a lens at any depth: alpha@1, nested@2, and
  // (exported) beta@6. The arrow and function expression are values → no lens.
  const fixture = [
    "'use strict';",                       // 0
    'function alpha() {',                  // 1  → lens
    '    function nested() { return 0; }', // 2  → lens (nested decl)
    '    return nested();',                // 3
    '}',                                   // 4
    '',                                    // 5
    'export function beta(x) {',           // 6  → lens
    '    return x;',                       // 7
    '}',                                   // 8
    '',                                    // 9
    'let gamma = () => 42;',               // 10 (arrow — no lens)
    'let delta = function () { return 1; };', // 11 (fn expression — no lens)
    ''                                     // 12
  ].join('\n');
  const file = path.join(__dirname, '..', 'test-codelens-fixture.uc');

  before(async function() {
    lspServer = createLSPTestServer();
    initResult = await lspServer.initialize();
    getCodeLens = lspServer.getCodeLens;
    resolveCodeLens = lspServer.resolveCodeLens;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  // Only meaningful when this suite owns the server (standalone run); under the
  // shared-server curated suite, initialize() resolves with no result.
  it('advertises codeLensProvider with resolveProvider', function() {
    if (!initResult || !initResult.capabilities) this.skip();
    assert.ok(initResult.capabilities.codeLensProvider, 'codeLensProvider should be advertised');
    assert.strictEqual(initResult.capabilities.codeLensProvider.resolveProvider, true);
  });

  it('returns a lens for each function declaration (incl. nested), but not arrows/expressions', async function() {
    const lenses = await getCodeLens(fixture, file);
    assert.ok(Array.isArray(lenses), 'expected an array of lenses');
    assert.strictEqual(lenses.length, 3, `expected 3 lenses (alpha, nested, beta), got ${lenses.length}`);
    const lines = lenses.map(l => l.range.start.line).sort((a, b) => a - b);
    assert.deepStrictEqual(lines, [1, 2, 6], `lens anchor lines: ${JSON.stringify(lines)}`);
    // onCodeLens must not pre-resolve the command (lazy).
    assert.ok(lenses.every(l => !l.command), 'lenses should be unresolved (no command) initially');
  });

  it('resolve attaches a command with a non-empty title', async function() {
    const lenses = await getCodeLens(fixture, file);
    const resolved = await resolveCodeLens(lenses[0]);
    assert.ok(resolved.command, 'resolved lens should carry a command');
    assert.ok(typeof resolved.command.title === 'string' && resolved.command.title.length > 0,
      `expected a non-empty title, got: ${JSON.stringify(resolved.command)}`);
  });

  it('anchors on the function line, not above a leading comment/JSDoc', async function() {
    const commented = [
      '/**',                  // 0
      ' * @param {object} a', // 1
      ' */',                  // 2
      'function withDoc(a) {',// 3  → lens here, NOT line 0
      '    return a;',        // 4
      '}',                    // 5
      '',                     // 6
      '/*',                   // 7
      ' long',                // 8
      ' block',               // 9
      ' */',                  // 10
      'function withBlock() {',// 11 → lens here, NOT line 7
      '    return 1;',        // 12
      '}',                    // 13
      ''
    ].join('\n');
    const lenses = await getCodeLens(commented, path.join(__dirname, '..', 'test-codelens-comments.uc'));
    const lines = lenses.map(l => l.range.start.line).sort((a, b) => a - b);
    assert.deepStrictEqual(lines, [3, 11], `lens should sit on the function lines, got: ${JSON.stringify(lines)}`);
  });
});
