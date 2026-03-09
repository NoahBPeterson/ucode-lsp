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

// --- Nullish coalescing (??) type inference tests ---

test('should infer fallback type for null ?? fallback', async () => {
  const content = `
let x = null;
let y = x ?? "default";
// y should be string, so string operations should work
let z = substr(y, 0, 3); // No diagnostic expected
`;

  const testPath = path.join(__dirname, 'temp-nullish-coalescing-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    // Should not warn about type mismatch on substr since y is string
    const substrDiag = diagnostics.filter(d =>
      d.message.includes('substr') && d.message.includes('type')
    );
    expect(substrDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should not produce unknown type for ?? expressions', async () => {
  const content = `
function maybe_null(x) {
  if (type(x) == "string") return null;
  return 42;
}
let val = maybe_null(1) ?? 10;
// val should be usable as a number
let result = val + 1;
`;

  const testPath = path.join(__dirname, 'temp-nullish-coalescing-test2.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    // Should not produce type errors for number operations on val
    const typeDiag = diagnostics.filter(d =>
      d.message.includes('Cannot apply') && d.range.start.line >= 5
    );
    expect(typeDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

// --- Truthiness narrowing tests ---

test('should narrow variable to non-null in if (x) body', async () => {
  const content = `
function null_or_array(t) {
  if (type(t) == "string") return null;
  return [1, 2, 3];
}

let a = null_or_array(1);

if (a) {
    // a is truthy here, so null is excluded
    if (5 in a) { // Should NOT warn about null
        print("found");
    }
}
`;

  const testPath = path.join(__dirname, 'temp-truthiness-narrowing-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes("null") && d.range.start.line >= 8 && d.range.start.line <= 12
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow variable to non-null in if (x && expr) body', async () => {
  const content = `
function null_or_object(t) {
  if (type(t) == "string") return null;
  return { "name": "test" };
}

let a = null_or_object(1);

if (a && length(keys(a)) > 0) {
    // a is non-null here due to && truthiness guard
    let k = keys(a); // Should NOT warn about null
    print(k);
}
`;

  const testPath = path.join(__dirname, 'temp-and-truthiness-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes("null") && d.range.start.line >= 8 && d.range.start.line <= 12
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow variable to non-null in else of if (!x)', async () => {
  const content = `
function null_or_array(t) {
  if (type(t) == "string") return null;
  return [1, 2, 3];
}

let a = null_or_array(1);

if (!a) {
    print("a is falsy");
} else {
    // a is truthy here, null excluded
    if (5 in a) { // Should NOT warn about null
        print("found");
    }
}
`;

  const testPath = path.join(__dirname, 'temp-negated-truthiness-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes("null") && d.range.start.line >= 10 && d.range.start.line <= 14
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

// --- Post-early-exit type narrowing tests ---

test('should narrow type after if (type(x) != "object") die()', async () => {
  const content = `
function test_fn(r) {
    if (type(r) != "object")
        die("bad");
    let k = keys(r);
    print(k);
}
`;

  const testPath = path.join(__dirname, 'temp-early-exit-die-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    console.log('Early-exit die() diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line,
      code: d.code
    })));
    // keys(r) should not warn — r is narrowed to object after die()
    const keysDiag = diagnostics.filter(d =>
      d.message.includes("keys") && d.range.start.line >= 4
    );
    expect(keysDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow type after if (type(x) != "object") return', async () => {
  const content = `
function test_fn(r) {
    if (type(r) != "object")
        return null;
    let k = keys(r);
    print(k);
}
`;

  const testPath = path.join(__dirname, 'temp-early-exit-return-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    console.log('Early-exit return diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line,
      code: d.code
    })));
    // keys(r) should not warn — r is narrowed to object after return
    const keysDiag = diagnostics.filter(d =>
      d.message.includes("keys") && d.range.start.line >= 4
    );
    expect(keysDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow type after if (!x) die() — x is non-null', async () => {
  const content = `
function null_or_obj(t) {
    if (type(t) == "string") return null;
    return {"name": "test"};
}

function test_fn() {
    let a = null_or_obj(1);
    if (!a)
        die("a is null");
    let k = keys(a);
    print(k);
}
`;

  const testPath = path.join(__dirname, 'temp-early-exit-negated-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    console.log('Early-exit negated truthiness diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line,
      code: d.code
    })));
    // keys(a) should not warn about null — a is narrowed to non-null after die()
    const nullDiag = diagnostics.filter(d =>
      d.message.includes("null") && d.range.start.line >= 10
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow unknown param via type guard + die()', async () => {
  const content = `
function process(r) {
    if (type(r) != "object")
        die("expected object");
    // r should be narrowed to object here
    let name = r.name;
    print(name);
}
`;

  const testPath = path.join(__dirname, 'temp-early-exit-unknown-param-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    console.log('Early-exit unknown param diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line,
      code: d.code
    })));
    // r.name should not warn about member access on non-object — r is narrowed to object
    const memberDiag = diagnostics.filter(d =>
      (d.message.includes("member") || d.message.includes("property")) && d.range.start.line >= 4
    );
    expect(memberDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should NOT narrow unknown param via bare truthiness (!val) early-exit', async () => {
  // !val only tells us val is truthy (not null/false/0/""), NOT its type.
  // keys(unknown) should return array|null since we can't guarantee val is an object.
  const content = `
function test_fn(val) {
    if (!val)
        die("val must not be null");
    let k = keys(val);
    print(k);
}
`;

  const testPath = path.join(__dirname, 'temp-no-narrow-unknown-truthiness.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    console.log('No-narrow unknown truthiness diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line,
      code: d.code
    })));

    const server = createLSPTestServer();
    await server.initialize();

    const lines = content.split('\n');
    let keysLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('keys(val)')) { keysLine = i; break; }
    }

    // Verify hover on val still shows unknown
    const valCol = lines[keysLine].indexOf('val)');
    const hoverVal = await server.getHover(content, testPath, keysLine, valCol);
    console.log('Hover on val after !val die():', hoverVal);
    if (hoverVal && hoverVal.contents) {
      const hoverText = typeof hoverVal.contents === 'string'
        ? hoverVal.contents
        : (hoverVal.contents.value || JSON.stringify(hoverVal.contents));
      expect(hoverText).toContain('unknown');
    }

    // Verify hover on k shows array | null (not just array)
    // keys(unknown) could return null if val isn't an object
    const kCol = lines[keysLine].indexOf('let k') + 4;
    const hoverK = await server.getHover(content, testPath, keysLine, kCol);
    console.log('Hover on k (keys(unknown)):', hoverK);
    if (hoverK && hoverK.contents) {
      const hoverText = typeof hoverK.contents === 'string'
        ? hoverK.contents
        : (hoverK.contents.value || JSON.stringify(hoverK.contents));
      expect(hoverText).toContain('null');
      console.log('keys(unknown) correctly returns array | null');
    }

    server.shutdown();
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should show warning (not error) for join(sep, array|null)', async () => {
  const content = `
function get_array_or_null() {
    if (time() > 0) return [1, 2, 3];
    return null;
}

let a1 = get_array_or_null();
let joined1 = join(",", a1);
`;

  const testPath = path.join(__dirname, 'temp-join-warning-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    // Should NOT have an error for the join() call — only a warning
    const joinErrors = diagnostics.filter(d =>
      d.severity === 1 && d.message.includes('null') && d.range.start.line === 7
    );
    expect(joinErrors.length).toBe(0);

    // Should have a warning
    const joinWarnings = diagnostics.filter(d =>
      d.severity === 2 && d.range.start.line === 7
    );
    expect(joinWarnings.length).toBeGreaterThan(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should upgrade possibly-null warning to error with use strict', async () => {
  const content = `'use strict';

function get_string_or_null() {
    if (time() > 0) return "hello";
    return null;
}

let s1 = get_string_or_null();
let parts1 = split(s1, ",");
`;

  const testPath = path.join(__dirname, 'temp-strict-mode-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    // In strict mode, the possibly-null warning should be an error (severity 1)
    const splitErrors = diagnostics.filter(d =>
      d.severity === 1 && d.range.start.line === 8 && d.message.includes('null')
    );
    expect(splitErrors.length).toBeGreaterThan(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should show warning (not error) for split(string|null) without strict mode', async () => {
  const content = `
function get_string_or_null() {
    if (time() > 0) return "hello";
    return null;
}

let s1 = get_string_or_null();
let parts1 = split(s1, ",");
`;

  const testPath = path.join(__dirname, 'temp-split-warning-test.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    // Should NOT have an error
    const splitErrors = diagnostics.filter(d =>
      d.severity === 1 && d.range.start.line === 7 && d.message.includes('null')
    );
    expect(splitErrors.length).toBe(0);

    // Should have a warning
    const splitWarnings = diagnostics.filter(d =>
      d.severity === 2 && d.range.start.line === 7
    );
    expect(splitWarnings.length).toBeGreaterThan(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

// --- Builtin call type guard narrowing tests ---

test('should narrow x to non-null after if (length(x) >= 2)', async () => {
  const content = `
function get_array_or_null() {
    if (time() > 0) return [1, 2, 3];
    return null;
}

let parts = get_array_or_null();
if (length(parts) >= 2) {
    let joined = join(",", parts); // Should NOT warn — parts narrowed to array
}
`;

  const testPath = path.join(__dirname, 'temp-builtin-guard-gte2.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes('null') && d.range.start.line >= 8 && d.range.start.line <= 10
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow x to non-null after if (length(x) > 0)', async () => {
  const content = `
function get_array_or_null() {
    if (time() > 0) return [1, 2, 3];
    return null;
}

let parts = get_array_or_null();
if (length(parts) > 0) {
    let joined = join(",", parts); // Should NOT warn
}
`;

  const testPath = path.join(__dirname, 'temp-builtin-guard-gt0.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes('null') && d.range.start.line >= 8 && d.range.start.line <= 10
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should NOT narrow x after if (length(x) >= 0) — null >= 0 is true', async () => {
  const content = `
function get_array_or_null() {
    if (time() > 0) return [1, 2, 3];
    return null;
}

let parts = get_array_or_null();
if (length(parts) >= 0) {
    let joined = join(",", parts); // SHOULD still warn — null >= 0 is true in ucode
}
`;

  const testPath = path.join(__dirname, 'temp-builtin-guard-gte0.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes('null') && d.range.start.line >= 8 && d.range.start.line <= 10
    );
    expect(nullDiag.length).toBeGreaterThan(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow x via truthiness: if (length(x))', async () => {
  const content = `
function get_array_or_null() {
    if (time() > 0) return [1, 2, 3];
    return null;
}

let parts = get_array_or_null();
if (length(parts)) {
    let joined = join(",", parts); // Should NOT warn
}
`;

  const testPath = path.join(__dirname, 'temp-builtin-guard-truthiness.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes('null') && d.range.start.line >= 8 && d.range.start.line <= 10
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should work with reversed comparison: if (0 < length(x))', async () => {
  const content = `
function get_array_or_null() {
    if (time() > 0) return [1, 2, 3];
    return null;
}

let parts = get_array_or_null();
if (0 < length(parts)) {
    let joined = join(",", parts); // Should NOT warn
}
`;

  const testPath = path.join(__dirname, 'temp-builtin-guard-reversed.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes('null') && d.range.start.line >= 8 && d.range.start.line <= 10
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});

test('should narrow split result via length guard', async () => {
  const content = `
function get_str_or_null() {
    if (time() > 0) return "a,b,c";
    return null;
}

let s = get_str_or_null();
let parts = split(s, ",");
if (length(parts) >= 2) {
    let joined = join(",", parts); // Should NOT warn — parts narrowed to array
}
`;

  const testPath = path.join(__dirname, 'temp-builtin-guard-split.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiag = diagnostics.filter(d =>
      d.message.includes('null') && d.range.start.line >= 9 && d.range.start.line <= 11
    );
    expect(nullDiag.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  }
});
