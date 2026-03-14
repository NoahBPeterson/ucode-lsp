const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should narrow union types with OR type guards correctly', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-or-narrowing.uc');
    const testContent = `function getArrayOrObject(x) {
    if (type(x) == 'int') {
        return {"key": "value"};
    }
    return [1, 2, 3];
}

let unionValue = getArrayOrObject("test");

// This should warn - unionValue is object | array
arrtoip(unionValue);

// This should NOT warn - narrowed to array
if (type(unionValue) === "array")
    arrtoip(unionValue);

// This should warn - unionValue is object | array
index(unionValue, "key");

// This should NOT warn - narrowed to unknown (string not in union)
if (type(unionValue) === "string")
    index(unionValue, "key");

// This should NOT warn - narrowed to array
if (type(unionValue) === "array")
    index(unionValue, "key");

// This should NOT warn - narrowed to array (string not in union, so ignored)
if (type(unionValue) === "array" || type(unionValue) == "string")
    index(unionValue, "key");
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    console.log('\n=== ALL DIAGNOSTICS ===');
    diagnostics.forEach(d => {
      const line = d.range.start.line + 1;
      console.log(`Line ${line}: ${d.message}`);
    });

    // Check line 11: arrtoip(unionValue) - should warn
    const line11Warnings = diagnostics.filter(d =>
      d.range.start.line === 10 &&
      d.message.includes('arrtoip') &&
      d.message.includes('object')
    );
    expect(line11Warnings.length).toBeGreaterThan(0);
    console.log('✓ Line 11: Warning for arrtoip(unionValue) where unionValue is object | array');

    // Check line 15: arrtoip(unionValue) inside type guard - should NOT warn
    const line15Warnings = diagnostics.filter(d =>
      d.range.start.line === 14 &&
      d.message.includes('arrtoip')
    );
    expect(line15Warnings.length).toBe(0);
    console.log('✓ Line 15: No warning for arrtoip(unionValue) after narrowing to array');

    // Check line 18: index(unionValue, "key") - should warn
    const line18Warnings = diagnostics.filter(d =>
      d.range.start.line === 17 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    expect(line18Warnings.length).toBeGreaterThan(0);
    console.log('✓ Line 18: Warning for index(unionValue, "key") where unionValue is object | array');

    // Check line 22: index inside type(x) === "string" guard
    // unionValue is object | array, narrowing to "string" yields unknown (string not in union)
    // so index(unknown) correctly warns
    const line22Warnings = diagnostics.filter(d =>
      d.range.start.line === 21 &&
      d.message.includes('index')
    );
    expect(line22Warnings.length).toBe(1);
    console.log('✓ Line 22: Warning for index(unknown) after narrowing to string (not in union)');

    // Check line 26: index inside type(x) === "array" guard - should NOT warn
    const line26Warnings = diagnostics.filter(d =>
      d.range.start.line === 25 &&
      d.message.includes('index')
    );
    expect(line26Warnings.length).toBe(0);
    console.log('✓ Line 26: No warning for index after narrowing to array');

    // Check line 30: index inside OR guard - should NOT warn (this is the bug we're fixing)
    const line30Warnings = diagnostics.filter(d =>
      d.range.start.line === 29 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    expect(line30Warnings.length).toBe(0);
    console.log('✓ Line 30: No warning for index after OR type guard (array || string)');

  } finally {
    server.shutdown();
  }
});
