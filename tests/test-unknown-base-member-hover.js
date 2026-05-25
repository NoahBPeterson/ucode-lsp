const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Accessing a member on an `unknown`-typed base — e.g. `let ctx = unknown_call();
// ctx.get(...)` — used to produce NO hover at all, because hover bailed once it
// couldn't resolve a known object type / module for the base. We now surface a
// minimal hover so `.prop` on an unknown still shows something and explains why
// richer info is missing.
describe('Member hover on an unknown-typed base', function() {
  this.timeout(15000);

  let lspServer, getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function hoverText(hover) {
    if (!hover || !hover.contents) return '';
    return typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
  }

  it('`ctx.get` where ctx is an unknown param yields a hover (not undefined)', async function() {
    const content = [
      "'use strict';",
      'function f(ctx, iface) {',
      "    return ctx.get('network', iface, 'device');",
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-unknown-base-hover.uc');

    // Line 2 = "    return ctx.get(...)"; `get` starts at char 15.
    const hover = await getHover(content, file, 2, 16);

    assert.ok(hover && hover.contents, 'expected a hover for .get on an unknown base');
    const text = hoverText(hover);
    assert.ok(/get/.test(text), `hover should name the member, got: ${text}`);
    assert.ok(/unknown/.test(text), `hover should mention the unknown type, got: ${text}`);
    assert.ok(/ctx/.test(text), `hover should reference the base variable, got: ${text}`);
  });

  it('`pkg.rt_tables_file` on a generic `object` param yields a hover', async function() {
    const content = [
      '/**',
      ' * @param {object} pkg',
      ' */',
      'function f(pkg) {',
      '    return pkg.rt_tables_file;',
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-object-base-hover.uc');

    // Line 4 = "    return pkg.rt_tables_file;"; member starts at char 15.
    const hover = await getHover(content, file, 4, 18);

    assert.ok(hover && hover.contents, 'expected a hover for a member of an object param');
    const text = hoverText(hover);
    assert.ok(/rt_tables_file/.test(text), `hover should name the member, got: ${text}`);
    assert.ok(/object/.test(text), `hover should mention the object base, got: ${text}`);
  });
});
