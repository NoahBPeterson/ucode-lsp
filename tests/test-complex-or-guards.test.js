const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should handle complex OR guards with multiple conditions and negatives', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-complex-or.uc');
    const testContent = `function getArrayOrObject(x) {
    if (type(x) == 'int') {
        return {"key": "value"};
    }
    return [1, 2, 3];
}

let unionValue = getArrayOrObject("test");

// Test 1: Three OR conditions with one null check
if (type(unionValue) === "array" || type(unionValue) == "string" || type(unionValue) !== null)
    index(unionValue, "key");

// Test 2: Negative guard - should remove object
if (type(unionValue) !== "object" || type(unionValue) == "string")
    index(unionValue, "key");
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    console.log('\n=== ALL DIAGNOSTICS ===');
    diagnostics.forEach(d => {
      const line = d.range.start.line + 1;
      console.log(`Line ${line}: ${d.message}`);
    });

    // Test 1: Line 12 - SHOULD warn (tautology: !== null doesn't narrow object|array)
    const line12Warnings = diagnostics.filter(d =>
      d.range.start.line === 11 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    expect(line12Warnings.length).toBe(1);
    console.log('✓ Test 1: Warning for triple OR guard with tautology (array || string || !== null)');

    // Test 2: Line 16 - should NOT warn (narrowed to array by removing object)
    const line16Warnings = diagnostics.filter(d =>
      d.range.start.line === 15 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    expect(line16Warnings.length).toBe(0);
    console.log('✓ Test 2: No warning for negative guard (!== object || == string)');

    // Get hover for test 1
    const lines = testContent.split('\n');
    const test1Line = lines.findIndex(line => line.includes('index(unionValue') && lines[lines.findIndex(l => l.includes('!== null'))]);
    const test1Column = lines[test1Line].indexOf('unionValue');
    const hover1 = await server.getHover(testContent, testPath, test1Line, test1Column);

    console.log('\n=== HOVER TEST 1 ===');
    console.log('Hover:', hover1?.contents);

    // Should show UN-narrowed type (tautology prevents narrowing)
    const hoverText1 = typeof hover1.contents === 'string' ? hover1.contents : hover1.contents.value;
    expect(hoverText1).toContain('object | array');
    console.log('✓ Hover shows un-narrowed type for test 1 (tautology prevents narrowing)');

  } finally {
    server.shutdown();
  }
});
