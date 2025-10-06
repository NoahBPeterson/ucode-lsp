const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should show narrowed type in hover for OR type guards', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-or-hover.uc');
    const testContent = `function getArrayOrObject(x) {
    if (type(x) == 'int') {
        return {"key": "value"};
    }
    return [1, 2, 3];
}

let unionValue = getArrayOrObject("test");

if (type(unionValue) === "array" || type(unionValue) == "string")
    index(unionValue, "key");
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    // Get hover information for unionValue inside the if block
    const lines = testContent.split('\n');
    const targetLine = lines.findIndex(line => line.includes('index(unionValue'));
    const targetColumn = lines[targetLine].indexOf('unionValue');

    const hover = await server.getHover(testContent, testPath, targetLine, targetColumn);

    console.log('\n=== HOVER INFO ===');
    console.log('Line:', targetLine + 1);
    console.log('Content:', lines[targetLine]);
    console.log('Hover:', hover?.contents);

    // The hover should show the narrowed type (array), not the original (object | array)
    expect(hover).toBeDefined();
    const hoverText = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;

    // Should show 'array' type, not 'object | array'
    expect(hoverText).toContain('array');
    expect(hoverText).not.toContain('object | array');
    expect(hoverText).not.toContain('object');

    console.log('✓ Hover shows narrowed type: array');

  } finally {
    server.shutdown();
  }
});
