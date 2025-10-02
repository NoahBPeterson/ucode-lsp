const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

test("should support 'import default, * as namespace from module' syntax", async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    // Create the module file
    const modulePath = path.join(__dirname, "temp-test-module.uc");
    const moduleContent = `export default { name: "default export" };
export let MY_CONST = 42;
export let ANOTHER_CONST = "hello";

export function myFunction() {
    return "from myFunction";
};
`;
    fs.writeFileSync(modulePath, moduleContent);

    // Create the import file
    const importPath = path.join(__dirname, "temp-test-import.uc");
    const importContent = `import wireless, * as wconst from 'temp-test-module';

print("Default import:", wireless);
print("Namespace import:", wconst);
print("MY_CONST from namespace:", wconst.MY_CONST);
`;
    fs.writeFileSync(importPath, importContent);

    try {
      const diagnostics = await server.getDiagnostics(importContent, importPath);

      // Filter out any diagnostics related to the import statement
      const importDiagnostics = diagnostics.filter(d => {
        const line = d.line || 0;
        return line === 0; // Line with import statement (0-indexed)
      });

      console.log("Import diagnostics:", importDiagnostics);

      // Should have no diagnostics on the import line
      expect(importDiagnostics.length).toBe(0);
      console.log("✓ Import syntax 'import default, * as namespace from module' works without errors");
    } finally {
      if (fs.existsSync(modulePath)) {
        fs.unlinkSync(modulePath);
      }
      if (fs.existsSync(importPath)) {
        fs.unlinkSync(importPath);
      }
    }
  } finally {
    server.shutdown();
  }
});
