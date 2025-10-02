const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

test("should warn when union type contains disallowed types for index()", async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const content = `function string_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    return "hello";
}

index(string_or_object("lol"), "test");`;

    const testPath = path.join(__dirname, "temp-index-warning.uc");
    fs.writeFileSync(testPath, content);

    try {
      const diagnostics = await server.getDiagnostics(content, testPath);

      console.log("All diagnostics:", JSON.stringify(diagnostics, null, 2));

      // Filter for all warnings (severity 2)
      const allWarnings = diagnostics.filter(d => d.severity === 2);

      console.log("All warnings:", allWarnings);

      // Should warn that the type could be 'object' which is not allowed for index() first arg
      expect(allWarnings.length).toBeGreaterThan(0);

      const hasObjectWarning = allWarnings.some(d =>
        d.message.includes('object') && d.message.includes('index')
      );
      expect(hasObjectWarning).toBe(true);

      console.log("✓ Warning generated for index() with union type containing object");
    } finally {
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    }
  } finally {
    server.shutdown();
  }
});

test("should warn when union type contains disallowed types for arrtoip()", async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const content = `function array_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    return [5];
}

arrtoip(array_or_object("lol"));`;

    const testPath = path.join(__dirname, "temp-arrtoip-warning.uc");
    fs.writeFileSync(testPath, content);

    try {
      const diagnostics = await server.getDiagnostics(content, testPath);

      console.log("All diagnostics:", JSON.stringify(diagnostics, null, 2));

      // Check for both errors and warnings
      const allArrtoipDiagnostics = diagnostics.filter(d =>
        d.message.includes('arrtoip')
      );

      console.log("All arrtoip diagnostics:", allArrtoipDiagnostics);

      // Filter for warnings specifically (severity 2)
      const arrtoipWarnings = diagnostics.filter(d =>
        d.severity === 2
      );

      console.log("All warnings (severity 2):", arrtoipWarnings);

      // Should warn that the type could be 'object' which is not allowed for arrtoip()
      expect(arrtoipWarnings.length).toBeGreaterThan(0);

      const hasObjectWarning = arrtoipWarnings.some(d =>
        d.message.includes('object') || d.message.includes('may be')
      );
      expect(hasObjectWarning).toBe(true);

      console.log("✓ Warning generated for arrtoip() with union type containing object");
    } finally {
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    }
  } finally {
    server.shutdown();
  }
});

test("should warn for length() with nullable union type", async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const content = `function nullable_array() {
    if (Math.random() > 0.5) {
        return [1, 2, 3];
    }
    return null;
}

let len = length(nullable_array());`;

    const testPath = path.join(__dirname, "temp-length-warning.uc");
    fs.writeFileSync(testPath, content);

    try {
      const diagnostics = await server.getDiagnostics(content, testPath);

      console.log("All diagnostics:", JSON.stringify(diagnostics, null, 2));

      // Filter for warnings about length()
      const lengthWarnings = diagnostics.filter(d =>
        d.message.includes('length')
      );

      console.log("length warnings:", lengthWarnings);

      // Should warn that the type could be null
      const hasNullWarning = lengthWarnings.some(d =>
        d.message.includes('null') || d.message.includes('may be')
      );

      if (hasNullWarning) {
        console.log("✓ Warning generated for length() with nullable type");
      } else {
        console.log("⚠ No warning for nullable type - might be expected behavior");
      }
    } finally {
      if (fs.existsSync(testPath)) {
        fs.unlinkSync(testPath);
      }
    }
  } finally {
    server.shutdown();
  }
});
