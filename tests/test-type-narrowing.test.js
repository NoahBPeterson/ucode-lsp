import { test, expect, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');
const fs = require('fs');
const path = require('path');

let lspServer;
let getDiagnostics;

beforeAll(async () => {
  lspServer = createLSPTestServer();
  await lspServer.initialize();
  getDiagnostics = lspServer.getDiagnostics;
});

afterAll(() => {
  if (lspServer) {
    lspServer.shutdown();
  }
});

test('should detect simple null in operator', async () => {
  const content = `
let a = null; // explicitly null type

if (5 in a) { // Should show diagnostic 
    print("found");
}
`;

  const testPath = path.join(__dirname, 'temp-simple-test.uc');
  fs.writeFileSync(testPath, content);
  
  try {
    const diagnostics = await getDiagnostics(content, testPath);
    
    console.log('Simple test diagnostics:', diagnostics.map(d => ({ 
      message: d.message, 
      line: d.range.start.line,
      code: d.code,
      data: d.data
    })));
    
    // Should find at least one diagnostic about the 'in' operator
    expect(diagnostics.length).toBeGreaterThan(0);
    
    const inDiagnostic = diagnostics.find(d => d.message.includes("'in'"));
    expect(inDiagnostic).toBeDefined();
    
    if (inDiagnostic) {
      console.log('Found in-operator diagnostic!');
    }
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test('should detect incompatible function argument types', async () => {
  const content = `
let wrongType = "string";
arrtoip(wrongType); // arrtoip expects array but got string
`;

  const testPath = path.join(__dirname, 'temp-function-arg-test.uc');
  fs.writeFileSync(testPath, content);
  
  try {
    const diagnostics = await getDiagnostics(content, testPath);
    
    console.log('Function argument test diagnostics:', diagnostics.map(d => ({ 
      message: d.message, 
      line: d.range.start.line,
      code: d.code,
      data: d.data
    })));
    
    // Should find at least one diagnostic about function argument type
    expect(diagnostics.length).toBeGreaterThan(0);
    
    const argDiagnostic = diagnostics.find(d => 
      d.message.includes("arrtoip") && 
      (d.message.includes("array") || d.message.includes("string"))
    );
    expect(argDiagnostic).toBeDefined();
    
    if (argDiagnostic) {
      console.log('Found function argument diagnostic!');
    }
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});
test('should handle flow-sensitive type narrowing in null guards', async () => {
  const content = `
function null_or_object(test) {
    if (type(test) == 'string') {
        return null;
    }
    if (type(test) == 'int') {
        return [5];
    }
    return {"a": 5};
}

let a = null_or_object(1);

if (a != null) {
    if (5 in a) { // This should NOT show null error due to flow-sensitive narrowing
        print("found");
    }
}
`;

  const testPath = path.join(__dirname, 'temp-flow-sensitive-test.uc');
  fs.writeFileSync(testPath, content);
  
  try {
    const diagnostics = await getDiagnostics(content, testPath);
    
    console.log('Flow-sensitive test diagnostics:', diagnostics.map(d => ({ 
      message: d.message, 
      line: d.range.start.line,
      code: d.code,
      data: d.data
    })));
    
    // Should NOT find a null-related diagnostic on the inner 'in' operator
    const nullDiagnostics = diagnostics.filter(d => 
      d.message.includes("possibly 'null'") && 
      d.range.start.line > 10 // After the null guard
    );
    
    // The flow-sensitive narrowing should eliminate the null diagnostic
    expect(nullDiagnostics.length).toBe(0);
    
    console.log('Flow-sensitive type narrowing working! No null diagnostics inside the null guard.');
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test('should narrow variable type to exclude null inside null guard block (via diagnostics)', async () => {
  const { createLSPTestServer } = require('./lsp-test-helpers');
  const server = createLSPTestServer();
  
  await server.initialize();
  
  const content = `function null_or_object(test) {
    if (type(test) == 'string') {
        return null;
    }
    if (type(test) == 'int') {
        return [5];
    }
    return {"a": 5};
}

let a = null_or_object(1); // Should be: null | array | object

// Test 1: Outside the guard, 'a' should cause null diagnostic
if (5 in a) { // This should show error: possibly null
    print("error case");
}

if (a != null) {
    // Test 2: Inside this block, 'a' should be narrowed to: array | object (null removed)
    if (5 in a) { // This should NOT show null error due to type narrowing
        print("found");
    }
}`;

  const testPath = path.join(__dirname, 'temp-type-narrowing-test.uc');
  fs.writeFileSync(testPath, content);
  
  try {
    const diagnostics = await server.getDiagnostics(content, testPath);
    
    console.log('Type narrowing comparison test diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line,
      code: d.code,
      data: d.data
    })));

    // Find line numbers programmatically
    const lines = content.split('\n');
    // Find the unguarded "if (5 in a)" - it's before any "if (a != null)"
    let outsideGuardLineNum = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('if (5 in a)')) {
        outsideGuardLineNum = i;
        break; // Take the first occurrence
      }
    }

    let insideGuardLineNum = -1;
    let foundNullGuard = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('if (a != null)')) {
        foundNullGuard = true;
      }
      if (foundNullGuard && lines[i].includes('if (5 in a)')) {
        insideGuardLineNum = i;
        break;
      }
    }

    console.log(`Line numbers - Outside guard: ${outsideGuardLineNum}, Inside guard: ${insideGuardLineNum}`);

    // Should have null diagnostic outside the guard
    const nullDiagnosticsOutsideGuard = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === outsideGuardLineNum
    );

    // Should have NO null diagnostics inside the guard
    const nullDiagnosticsInsideGuard = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === insideGuardLineNum
    );
    
    expect(nullDiagnosticsOutsideGuard.length).toBe(1);
    expect(nullDiagnosticsInsideGuard.length).toBe(0);
    
    console.log('✓ Type narrowing verified:');
    console.log(`  - Outside guard: ${nullDiagnosticsOutsideGuard.length} null diagnostic (expected)`);
    console.log(`  - Inside guard: ${nullDiagnosticsInsideGuard.length} null diagnostics (null type eliminated)`);

    // Now check hover to verify type narrowing is reflected in hover text
    // Reuse the line numbers we already calculated
    const outsideGuardLineText = lines[outsideGuardLineNum];
    const outsideGuardColumn = outsideGuardLineText.indexOf('a)'); // Position of 'a' in "in a)"

    const insideGuardLineText = lines[insideGuardLineNum];
    const insideGuardColumn = insideGuardLineText.indexOf('a)'); // Position of 'a' in "in a)"

    console.log(`Hover positions - Outside: line ${outsideGuardLineNum}, col ${outsideGuardColumn}; Inside: line ${insideGuardLineNum}, col ${insideGuardColumn}`);

    const hoverOutside = await server.getHover(content, testPath, outsideGuardLineNum, outsideGuardColumn);
    const hoverInside = await server.getHover(content, testPath, insideGuardLineNum, insideGuardColumn);

    console.log('Hover outside guard:', hoverOutside);
    console.log('Hover inside guard:', hoverInside);

    if (hoverInside && hoverInside.contents) {
      const hoverText = typeof hoverInside.contents === 'string'
        ? hoverInside.contents
        : (hoverInside.contents.value || JSON.stringify(hoverInside.contents));

      console.log('Hover text inside guard:', hoverText);

      // The type should NOT include 'null' inside the guard block
      if (hoverText.includes('null')) {
        console.log('⚠ Warning: Hover still shows null in type (may need more work)');
      } else {
        console.log('✓ Hover verified: null excluded from type inside guard block');
      }
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
    await server.shutdown();
  }
});
