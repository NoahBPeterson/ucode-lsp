const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Binding a module function to a local (`let readfile = fs_mod.readfile`) used to
// infer `unknown`. checkMemberExpression now types a module member function as
// `function`, and the variable is stamped with the module + member so hover shows
// the full signature — whether the module came from `@param {module:fs}` or
// `require('fs')`.
describe('Module member function bound to a variable', function() {
  this.timeout(15000);

  let lspServer, getHover, getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function hoverText(h) {
    if (!h || !h.contents) return '';
    return typeof h.contents === 'string' ? h.contents : h.contents.value || '';
  }

  it('resolves a member of a `@param {module:fs}` parameter', async function() {
    const content = [
      '/**',
      ' * @param {module:fs} fs_mod',
      ' */',
      'function make(fs_mod) {',
      '    let readfile = fs_mod.readfile;',
      '    return readfile;',
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-modmember-jsdoc.uc');
    // Line 4 = "    let readfile = ..."; hover the `readfile` variable (~char 9).
    const text = hoverText(await getHover(content, file, 4, 9));
    assert.ok(/readfile\(path/.test(text), `expected fs.readfile signature, got: ${JSON.stringify(text)}`);
    assert.ok(!/unknown/.test(text), `should not be unknown: ${JSON.stringify(text)}`);
  });

  it('resolves a member of a `require(\'fs\')` result', async function() {
    const content = [
      "'use strict';",
      "let fs = require('fs');",
      '    let rf = fs.readfile;',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-modmember-require.uc');
    // Line 2 = "    let rf = fs.readfile;"; hover `rf` (~char 8).
    const text = hoverText(await getHover(content, file, 2, 8));
    assert.ok(/readfile\(path/.test(text), `expected fs.readfile signature, got: ${JSON.stringify(text)}`);
  });

  it('calling the bound function resolves its return type (readfile → string | null)', async function() {
    const content = [
      '/**',
      ' * @param {module:fs} fs_mod',
      ' * @param {object} pkg',
      ' */',
      'function make(fs_mod, pkg) {',
      '    let readfile = fs_mod.readfile;',
      "    let text = readfile(pkg.path) || '';",  // string | null, then || '' → string
      '    let m = match(text, /x/);',
      '    return m;',
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-modmember-callret.uc');
    // Line 6 = "    let text = ..."; hover `text` (~char 9).
    const textHover = hoverText(await getHover(content, file, 6, 9));
    assert.ok(/\bstring\b/.test(textHover) && !/unknown/.test(textHover),
      `readfile(...) || '' should be string, got: ${JSON.stringify(textHover)}`);
    // Because text is string, match()'s first arg is fine — no nullable-argument.
    const diags = await getDiagnostics(content, file);
    const nullableArg = diags.find(d => d.code === 'nullable-argument' || d.code === 'incompatible-function-argument');
    assert.ok(!nullableArg, `match() should not warn on a string arg, got: ${JSON.stringify(diags.map(d => d.code))}`);
  });

  it('`trim(fs_mod.readfile(p) || "")` inline in strict mode does not warn nullable-argument', async function() {
    // Regression: a member-call `|| ''` used directly as a builtin arg wasn't
    // null-narrowed (the description-based OR inference didn't strip null), so
    // strict mode wrongly flagged trim()'s arg as nullable.
    const content = [
      "'use strict';",
      '/**',
      ' * @param {module:fs} fs_mod',
      ' * @param {object} pkg',
      ' */',
      'function f(fs_mod, pkg) {',
      "    return trim(fs_mod.readfile(pkg.path) || '');",
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-modmember-orinline.uc');
    const diags = await getDiagnostics(content, file);
    const nullable = diags.find(d => d.code === 'nullable-argument');
    assert.ok(!nullable, `\`|| ''\` should make trim's arg non-null, got: ${JSON.stringify(diags.map(d => d.code))}`);
  });

  it('the bound function is callable without a "not a function" error', async function() {
    const content = [
      '/**',
      ' * @param {module:fs} fs_mod',
      ' */',
      'function make(fs_mod) {',
      '    let readfile = fs_mod.readfile;',
      '    return readfile("/etc/hostname");',
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-modmember-call.uc');
    const diags = await getDiagnostics(content, file);
    const badCall = diags.find(d => /not a function|is not callable/i.test(d.message || ''));
    assert.ok(!badCall, `bound module function should be callable, got: ${JSON.stringify(diags.map(d => d.message))}`);
  });
});
