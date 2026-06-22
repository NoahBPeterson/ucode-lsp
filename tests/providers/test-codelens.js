const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// E2e plumbing for the function CodeLenses. Each function declaration gets TWO
// lenses on its line: git history (kind 'git') + references (kind 'refs'). We
// assert the wiring — counts, anchor lines, and resolved titles/commands —
// WITHOUT asserting git commit content (environment-dependent; the fixture isn't
// a committed file, so the git title is the muted "No git history").
describe('Function CodeLenses (git history + references)', function() {
  this.timeout(15000);

  let lspServer, getCodeLens, resolveCodeLens, initResult;

  // Function DECLARATIONS get lenses at any depth: alpha@1, nested@2, and
  // (exported) beta@6. The arrow and function expression are values → no lens.
  const fixture = [
    "'use strict';",                       // 0
    'function alpha() {',                  // 1  → lenses
    '    function nested() { return 0; }', // 2  → lenses (nested decl)
    '    return nested();',                // 3
    '}',                                   // 4
    '',                                    // 5
    'export function beta(x) {',           // 6  → lenses
    '    return x;',                       // 7
    '}',                                   // 8
    '',                                    // 9
    'let gamma = () => 42;',               // 10 (arrow — no lens)
    'let delta = function () { return 1; };', // 11 (fn expression — no lens)
    ''                                     // 12
  ].join('\n');
  const file = path.join(__dirname, '..', 'test-codelens-fixture.uc');

  const byKind = (lenses, kind) => lenses.filter(l => l.data && l.data.kind === kind);
  const linesOf = (lenses) => lenses.map(l => l.range.start.line).sort((a, b) => a - b);

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

  it('emits a git + references lens per function declaration (incl. nested), not arrows/expressions', async function() {
    const lenses = await getCodeLens(fixture, file);
    assert.ok(Array.isArray(lenses), 'expected an array of lenses');
    assert.deepStrictEqual(linesOf(byKind(lenses, 'git')), [1, 2, 6], 'git lens lines');
    assert.deepStrictEqual(linesOf(byKind(lenses, 'refs')), [1, 2, 6], 'references lens lines');
    // onCodeLens must not pre-resolve commands (lazy).
    assert.ok(lenses.every(l => !l.command), 'lenses should be unresolved (no command) initially');
  });

  it('resolves the git lens to a titled command', async function() {
    const lenses = await getCodeLens(fixture, file);
    const git = byKind(lenses, 'git')[0];
    const resolved = await resolveCodeLens(git);
    assert.ok(resolved.command && typeof resolved.command.title === 'string' && resolved.command.title.length > 0,
      `expected a non-empty git title, got: ${JSON.stringify(resolved.command)}`);
  });

  it('references lens counts in-file references and wires a peek', async function() {
    const code = [
      'function helper() { return 1; }', // 0  → referenced 3x below
      'function main() {',               // 1  → 0 references
      '    return helper() + helper();', // 2  (2 refs)
      '}',                               // 3
      'helper();',                       // 4  (1 ref)
      ''
    ].join('\n');
    const f = path.join(__dirname, '..', 'test-codelens-refs.uc');
    const lenses = await getCodeLens(code, f);
    const refsLenses = byKind(lenses, 'refs');

    // helper lens (line 0) → "3 references" + showReferences command.
    const helperLens = refsLenses.find(l => l.range.start.line === 0);
    assert.ok(helperLens, 'expected a references lens on helper');
    const helperResolved = await resolveCodeLens(helperLens);
    assert.strictEqual(helperResolved.command.title, '3 references',
      `got: ${JSON.stringify(helperResolved.command)}`);
    assert.strictEqual(helperResolved.command.command, 'ucode.showFunctionReferences');
    // arguments: [uri, declPosition, locations[]]
    const locations = helperResolved.command.arguments[2];
    assert.strictEqual(locations.length, 3, `expected 3 locations, got ${locations.length}`);

    // main lens (line 1) → "no references", non-clickable.
    const mainLens = refsLenses.find(l => l.range.start.line === 1);
    const mainResolved = await resolveCodeLens(mainLens);
    assert.strictEqual(mainResolved.command.title, 'no references', `got: ${JSON.stringify(mainResolved.command)}`);
    assert.strictEqual(mainResolved.command.command, '', 'no-references lens should be non-clickable');
  });

  it('references are scope-aware: a shadowing param is not counted', async function() {
    const code = [
      'function foo() { return 1; }',       // 0  → declared here
      'function bar(foo) { return foo(); }', // 1  foo() is the PARAM (shadow) — not a ref
      'foo();',                              // 2  real reference
      ''
    ].join('\n');
    const f = path.join(__dirname, '..', 'test-codelens-shadow.uc');
    const lenses = await getCodeLens(code, f);
    const fooLens = byKind(lenses, 'refs').find(l => l.range.start.line === 0);
    const resolved = await resolveCodeLens(fooLens);
    assert.strictEqual(resolved.command.title, '1 reference',
      `shadowing param must not be counted, got: ${JSON.stringify(resolved.command.title)}`);
    assert.strictEqual(resolved.command.arguments[2].length, 1);
  });

  it('anchors lenses on the function line, not above a leading comment/JSDoc', async function() {
    const commented = [
      '/**',                  // 0
      ' * @param {object} a', // 1
      ' */',                  // 2
      'function withDoc(a) {',// 3  → lenses here, NOT line 0
      '    return a;',        // 4
      '}',                    // 5
      '',                     // 6
      '/*',                   // 7
      ' long',                // 8
      ' block',               // 9
      ' */',                  // 10
      'function withBlock() {',// 11 → lenses here, NOT line 7
      '    return 1;',        // 12
      '}',                    // 13
      ''
    ].join('\n');
    const lenses = await getCodeLens(commented, path.join(__dirname, '..', 'test-codelens-comments.uc'));
    const uniqueLines = [...new Set(linesOf(lenses))];
    assert.deepStrictEqual(uniqueLines, [3, 11], `lenses should sit on the function lines, got: ${JSON.stringify(uniqueLines)}`);
  });
});
