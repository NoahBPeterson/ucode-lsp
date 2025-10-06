const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should correctly count branches and prevent narrowing with non-guard expressions', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-branch-count.uc');

    // Test 1: Valid 2-guard OR - should narrow
    const test1Content = `function getArrayOrObject(x) {
    if (type(x) == 'int') {
        return {"key": "value"};
    }
    return [1, 2, 3];
}

let unionValue = getArrayOrObject("test");

if (type(unionValue) === "array" || type(unionValue) == "string")
    index(unionValue, "key");
`;

    const diag1 = await server.getDiagnostics(test1Content, testPath + '1');
    console.log('\n=== Test 1: 2 guards, 2 branches (should narrow to array, no warning) ===');
    const warnings1 = diag1.filter(d => d.message.includes('object'));
    console.log(`Warnings: ${warnings1.length} (expected 0)`);
    expect(warnings1.length).toBe(0);

    // Test 2: 2 guards + non-guard expression - should NOT narrow
    const test2Content = `function getArrayOrObject(x) {
    if (type(x) == 'int') {
        return {"key": "value"};
    }
    return [1, 2, 3];
}

let unionValue = getArrayOrObject("test");

if (type(unionValue) === "array" || type(unionValue) == "string" || true)
    index(unionValue, "key");
`;

    const diag2 = await server.getDiagnostics(test2Content, testPath + '2');
    console.log('\n=== Test 2: 2 guards, 3 branches with literal true (should NOT narrow, expect warning) ===');
    const warnings2 = diag2.filter(d => d.message.includes('object'));
    console.log(`Warnings: ${warnings2.length} (expected 1)`);
    expect(warnings2.length).toBe(1);

  } finally {
    server.shutdown();
  }
});
