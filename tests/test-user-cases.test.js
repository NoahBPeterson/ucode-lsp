const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

test("should warn on all user test cases", async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const content = `function array_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    return [5];
}

// Test 1: index with union in first arg
index(array_or_object("lol"), "test");

// Test 2: arrtoip with union
arrtoip(array_or_object("lol"));

// Test 3: length with nullable
function maybeNull(x) {
    return x > 5 ? null : [x];
}

let z = maybeNull(3);
let len2 = length(z);`;

    const testPath = path.join(__dirname, "temp-user-cases.uc");
    fs.writeFileSync(testPath, content);

    try {
      const diagnostics = await server.getDiagnostics(content, testPath);

      console.log("\nAll diagnostics:");
      diagnostics.forEach(d => {
        const line = d.range?.start?.line ?? d.line ?? 0;
        console.log(`Line ${line + 1}: [${d.severity === 1 ? 'ERROR' : 'WARNING'}] ${d.message}`);
      });

      // Filter for warnings (severity 2)
      const warnings = diagnostics.filter(d => d.severity === 2);

      console.log(`\nTotal warnings: ${warnings.length}`);

      // Should have at least 3 warnings:
      // 1. index() with object|array - warns about object
      // 2. arrtoip() with object|array - warns about object
      // 3. length() with null|array - warns about null
      expect(warnings.length).toBeGreaterThanOrEqual(3);

      console.log("✓ All expected warnings are present");
    } finally {
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    }
  } finally {
    server.shutdown();
  }
});
