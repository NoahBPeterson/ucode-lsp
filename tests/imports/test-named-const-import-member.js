const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// `import { E } from './util.uc'` where `export const E = { INVALID_PARAMS: -32602, ... }`.
// Two bugs, both fixed:
//   1) Member type: `E.INVALID_PARAMS` resolved to `unknown` because ucode parses a
//      negative number literal as a `-` UnaryExpression, and the cross-file type
//      inferrer had no UnaryExpression case (positive `NONE: 0` worked, negatives didn't).
//   2) Go-to-definition on the member did nothing — there was no named-import branch
//      resolving the property to its key inside the source object literal.
describe('Named import of an object-literal const: member type + go-to-def', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, '..', 'fixtures', 'constimport');
  const file = path.join(wsRoot, 'session.uc');
  const utilUri = 'file://' + path.join(wsRoot, 'util.uc');
  let lspServer, getHover, getDefinition;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDefinition = lspServer.getDefinition;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function hoverFirstLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }

  // Assign the member to a local and hover the local — avoids fragile single-token
  // hover on a cross-file member, while still validating the resolved member type.
  it('a NEGATIVE-valued constant member types as integer (was unknown)', async function() {
    const code = [
      "import { E } from './util.uc';",
      "let badparams = E.INVALID_PARAMS;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const h = hoverFirstLine(await getHover(code, file, 1, lines[1].indexOf('badparams') + 1));
    assert.ok(/integer/.test(h), `E.INVALID_PARAMS should be integer, got: ${JSON.stringify(h)}`);
  });

  it('a POSITIVE-valued constant member is still integer', async function() {
    const code = [
      "import { E } from './util.uc';",
      "let none = E.NONE;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const h = hoverFirstLine(await getHover(code, file, 1, lines[1].indexOf('none') + 1));
    assert.ok(/integer/.test(h), `E.NONE should be integer, got: ${JSON.stringify(h)}`);
  });

  it('a string-valued constant member is string', async function() {
    const code = [
      "import { NAMES } from './util.uc';",
      "let okv = NAMES.OK;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const h = hoverFirstLine(await getHover(code, file, 1, lines[1].indexOf('okv') + 1));
    assert.ok(/string/.test(h), `NAMES.OK should be string, got: ${JSON.stringify(h)}`);
  });

  it('go-to-definition on a member jumps to the key in the source object literal', async function() {
    const code = [
      "import { E } from './util.uc';",
      "let badparams = E.INVALID_PARAMS;",
      ''
    ].join('\n');
    // Cursor on INVALID_PARAMS (the member, after the dot).
    const col = code.split('\n')[1].indexOf('INVALID_PARAMS') + 2;
    const def = await getDefinition(code, file, 1, col);
    assert.ok(def, 'expected a definition result');
    const loc = Array.isArray(def) ? def[0] : def;
    assert.strictEqual(loc.uri, utilUri, `should resolve into util.uc, got: ${loc.uri}`);

    // The target range should land on the INVALID_PARAMS key line in util.uc.
    const fs = require('fs');
    const utilText = fs.readFileSync(path.join(wsRoot, 'util.uc'), 'utf-8');
    const keyLine = utilText.split('\n')[loc.range.start.line];
    assert.ok(/INVALID_PARAMS/.test(keyLine), `target line should contain the key, got: ${JSON.stringify(keyLine)}`);
  });
});
