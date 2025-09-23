const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

function extractHoverText(hover) {
  if (!hover || !hover.contents) {
    return '';
  }

  const { contents } = hover;

  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map(entry => (typeof entry === 'string' ? entry : entry.value || '')).join('\n');
  }

  return contents.value || '';
}

describe('Object Property Hover (LSP)', function() {
  this.timeout(15000);

  let lspServer;
  let getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(async function() {
    if (lspServer) {
      await lspServer.shutdown();
    }
  });

  it('should report string type for object property and propagated variables', async function() {
    const lines = [
      'let zea = {};',
      'zea.lol = "lol";',
      'let efff = zea.lol;',
      'let alias = zea;',
      'let aliasValue = alias.lol;',
    ];

    const testContent = lines.join('\n');
    const testFilePath = path.join(__dirname, '..', 'test-object-property-hover.uc');

    const propertyLineIndex = lines.findIndex(line => line.includes('zea.lol ='));
    const propertyChar = lines[propertyLineIndex].indexOf('lol');

    const variableLineIndex = lines.findIndex(line => line.includes('let efff'));
    const variableChar = lines[variableLineIndex].indexOf('efff');

    const aliasLineIndex = lines.findIndex(line => line.includes('alias.lol'));
    const aliasPropertyChar = lines[aliasLineIndex].indexOf('lol');

    const propertyHover = await getHover(testContent, testFilePath, propertyLineIndex, propertyChar);
    const propertyText = extractHoverText(propertyHover);

    assert.ok(propertyHover && propertyHover.contents, 'Expected hover information for zea.lol');
    assert.ok(propertyText.toLowerCase().includes('string'), `Expected 'string' in hover, got: ${propertyText}`);

    const variableHover = await getHover(testContent, testFilePath, variableLineIndex, variableChar);
    const variableText = extractHoverText(variableHover);

    assert.ok(variableHover && variableHover.contents, 'Expected hover information for efff');
    assert.ok(variableText.toLowerCase().includes('string'), `Expected 'string' in hover for efff, got: ${variableText}`);

    const aliasHover = await getHover(testContent, testFilePath, aliasLineIndex, aliasPropertyChar);
    const aliasText = extractHoverText(aliasHover);

    assert.ok(aliasHover && aliasHover.contents, 'Expected hover information for alias.lol');
    assert.ok(aliasText.toLowerCase().includes('string'), `Expected 'string' in hover for alias.lol, got: ${aliasText}`);
    assert.ok(!aliasText.toLowerCase().includes('global'), `alias.lol, should not have global, got: ${aliasText}`);
  });
});
