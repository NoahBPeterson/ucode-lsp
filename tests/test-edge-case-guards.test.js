const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should handle edge case type guards correctly', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-edge-cases.uc');
    const testContent = `function getArrayOrObject(x) {
    if (type(x) == 'int') {
        return {"key": "value"};
    }
    return [1, 2, 3];
}

let unionValue = getArrayOrObject("test");

// Test 1: !== null with OR (should not affect narrowing for non-null union)
if (type(unionValue) === "array" || type(unionValue) == "string" || type(unionValue) !== null)
    index(unionValue, "key");

// Test 2: AND operator - both conditions must be true
if (type(unionValue) !== "object" && type(unionValue) == "string")
    index(unionValue, "key");

// Test 3: Nullish coalescing with type guard
if (type(unionValue) !== "object" ?? true)
    index(unionValue, "key");
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    console.log('\n=== ALL DIAGNOSTICS ===');
    diagnostics.forEach(d => {
      const line = d.range.start.line + 1;
      console.log(`Line ${line}: ${d.message}`);
    });

    // Test 1: Line 12 - should WARN because !== null doesn't narrow object|array
    const line12Warnings = diagnostics.filter(d =>
      d.range.start.line === 11 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    console.log(`\nTest 1 (line 12): Found ${line12Warnings.length} warnings (expected 1)`);
    expect(line12Warnings.length).toBe(1);

    // Test 2: Line 15 - should NOT warn (AND narrows to empty set, so type becomes 'unknown')
    const line15Warnings = diagnostics.filter(d =>
      d.range.start.line === 14 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    console.log(`Test 2 (line 15): Found ${line15Warnings.length} warnings (expected 0)`);
    expect(line15Warnings.length).toBe(0);

    // Test 3: Line 19 - should NOT warn (narrowed by !== "object")
    const line19Warnings = diagnostics.filter(d =>
      d.range.start.line === 18 &&
      d.message.includes('index') &&
      d.message.includes('object')
    );
    console.log(`Test 3 (line 19): Found ${line19Warnings.length} warnings (expected 0)`);
    expect(line19Warnings.length).toBe(0);

  } finally {
    server.shutdown();
  }
});
