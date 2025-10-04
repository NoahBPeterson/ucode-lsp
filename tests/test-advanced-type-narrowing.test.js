const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');

async function getDiagnostics(content, filePath) {
  const { createLSPTestServer } = require('./lsp-test-helpers');
  const server = createLSPTestServer();
  await server.initialize();

  try {
    const diagnostics = await server.getDiagnostics(content, filePath);
    await server.shutdown();
    return diagnostics;
  } catch (error) {
    await server.shutdown();
    throw error;
  }
}

async function getHover(content, filePath, line, character) {
  const { createLSPTestServer } = require('./lsp-test-helpers');
  const server = createLSPTestServer();
  await server.initialize();

  try {
    const hover = await server.getHover(content, filePath, line, character);
    await server.shutdown();
    return hover;
  } catch (error) {
    await server.shutdown();
    throw error;
  }
}

test('should narrow type in else block (negative narrowing)', async () => {
  const content = `function null_or_object(test) {
    if (type(test) == 'string') {
        return null;
    }
    if (type(test) == 'int') {
        return [5];
    }
    return {"a": 5};
}

let a = null_or_object(1);

if (a == null) {
    // Handle null case
    print("is null");
} else {
    // In else block, 'a' should be narrowed to non-null (array | object)
    if (5 in a) {
        print("found");
    }
}`;

  const testPath = path.join(__dirname, 'temp-else-narrowing.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    console.log('Else block narrowing diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line
    })));

    // Find the line with "if (5 in a)" inside the else block dynamically
    const lines = content.split('\n');
    let elseBlockLineNum = -1;
    let foundElse = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('} else {')) {
        foundElse = true;
      }
      if (foundElse && lines[i].includes('if (5 in a)')) {
        elseBlockLineNum = i;
        break;
      }
    }

    console.log(`Else block 'if (5 in a)' found at line: ${elseBlockLineNum}`);

    // Should have NO null diagnostics inside the else block
    const nullDiagnosticsInElse = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === elseBlockLineNum
    );

    expect(nullDiagnosticsInElse.length).toBe(0);
    console.log('✓ Else block narrowing verified: no null diagnostics');

    // Check hover in else block
    const elseLineText = lines[elseBlockLineNum];
    const elseColumn = elseLineText.indexOf('a)'); // Position of 'a' in "in a)"

    const hoverInElse = await getHover(content, testPath, elseBlockLineNum, elseColumn);

    if (hoverInElse && hoverInElse.contents) {
      const hoverText = typeof hoverInElse.contents === 'string'
        ? hoverInElse.contents
        : (hoverInElse.contents.value || JSON.stringify(hoverInElse.contents));

      console.log('Hover in else block:', hoverText);

      // Should NOT include null
      if (!hoverText.includes('null')) {
        console.log('✓ Hover verified: null excluded from type in else block');
      }
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test('should narrow type with nested if-else blocks', async () => {
  const content = `function null_or_object(test) {
    if (type(test) == 'string') return null;
    if (type(test) == 'int') return [5];
    return {"a": 5};
}

let a = null_or_object(1);

if (a == null) {
    print("null");
} else {
    // a is narrowed to non-null here
    if (type(a) == 'array') {
        // a is narrowed to array here
        let len = length(a);
    } else {
        // a is narrowed to object here (since it's not null and not array)
        if (5 in a) {
            print("has property");
        }
    }
}`;

  const testPath = path.join(__dirname, 'temp-nested-else-narrowing.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    console.log('Nested else block narrowing diagnostics:', diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line
    })));

    // Find the line with "if (5 in a)" inside the nested else block
    const lines = content.split('\n');
    let nestedElseLineNum = -1;
    let foundFirstElse = false;
    let foundTypeCheck = false;

    for (let i = 0; i < lines.length; i++) {
      if (!foundFirstElse && lines[i].includes('} else {')) {
        foundFirstElse = true;
      }
      if (foundFirstElse && lines[i].includes("if (type(a) == 'array')")) {
        foundTypeCheck = true;
      }
      if (foundTypeCheck && lines[i].includes('} else {')) {
        // This is the second else
        foundTypeCheck = false; // Start looking for the 'in' operator
      }
      if (foundFirstElse && !foundTypeCheck && lines[i].includes('if (5 in a)')) {
        nestedElseLineNum = i;
        break;
      }
    }

    console.log(`Nested else 'if (5 in a)' found at line: ${nestedElseLineNum}`);

    // Should have NO null diagnostics inside the nested else block
    const nullDiagnosticsInNestedElse = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === nestedElseLineNum
    );

    expect(nullDiagnosticsInNestedElse.length).toBe(0);
    console.log('✓ Nested else block narrowing verified: no null diagnostics');

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test('nested type() guard should narrow builtin arguments', async () => {
  const content = `function complexType(x) {
  if (x > 10)
      return null;
  if (x > 5)
      return {"data": x};
  return [x, x * 2];
}

let complex = complexType(3);

if (complex == null) {
  print(complex);
} else {
  if (type(complex) == 'array') {
      let ip = arrtoip(complex);
  }
}`;

  const testPath = path.join(__dirname, 'temp-nested-arrtoip-narrowing.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const typeWarnings = diagnostics.filter(d => d.severity === 2);
    const arrtoipWarnings = typeWarnings.filter(d => d.message.includes('arrtoip'));

    console.log(`arrtoip warnings in nested guard test: ${arrtoipWarnings.length}`);
    if (arrtoipWarnings.length > 0) {
      console.log('arrtoip warning messages:', arrtoipWarnings.map(d => d.message));
    }

    expect(arrtoipWarnings.length).toBe(0);
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("null equality guard should narrow to null in positive branch", async () => {
  const content = `function complexType(x) {
  if (x > 10)
      return null;
  if (x > 5)
      return {"data": x};
  return [x, x * 2];
}

let complex = complexType(7);

if (complex == null) {
  let len = length(complex);
  print(complex);
} else {
  print('not null');
}`;

  const testPath = path.join(__dirname, 'temp-null-guard-positive.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const lines = content.split('\n');
    const lengthLine = lines.findIndex(line => line.includes('length(complex)'));

    const hoverColumn = lines[lengthLine].indexOf('complex');
    const hover = await getHover(content, testPath, lengthLine, hoverColumn);

    if (!hover || !hover.contents) {
      throw new Error('Expected hover information for complex inside null guard');
    }

    const hoverText = typeof hover.contents === 'string'
      ? hover.contents
      : (hover.contents.value || JSON.stringify(hover.contents));

    expect(hoverText.includes('`null`')).toBe(true);
    expect(hoverText.includes('object')).toBe(false);
    expect(hoverText.includes('array')).toBe(false);
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow type in switch cases", async () => {
  const content = `function getArrayOrObject(x) {
  if (x > 5)
      return [x, x * 2];
  return {"key": x};
}

let value = getArrayOrObject(10);

switch (type(value)) {
  case 'array':
      let arrayLen = length(value);
      arrtoip(value);
      break;

  case 'object':
      if ("key" in value) {
          print(value.key);
      }
      break;
}`;

  const testPath = path.join(__dirname, 'temp-switch-type-narrowing.uc');
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const lines = content.split('\n');
    const arrtoipLine = lines.findIndex(line => line.includes('arrtoip(value)'));
    const inLine = lines.findIndex(line => line.includes('"key" in value'));

    const typeWarnings = diagnostics.filter(d => d.severity === 2);

    const arrtoipWarnings = typeWarnings.filter(d =>
      d.message.includes('arrtoip') &&
      (d.range?.start?.line === arrtoipLine || d.line === arrtoipLine)
    );

    const inWarnings = typeWarnings.filter(d =>
      d.message.includes("'in' operator") &&
      (d.range?.start?.line === inLine || d.line === inLine)
    );

    if (arrtoipWarnings.length > 0) {
      throw new Error(`arrtoip warnings: ${JSON.stringify(arrtoipWarnings, null, 2)}`);
    }

    if (inWarnings.length > 0) {
      throw new Error(`in-operator warnings: ${JSON.stringify(inWarnings, null, 2)}`);
    }
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow type in logical AND (&&) expressions", async () => {
  const content = `function null_or_object(test) {
    if (type(test) == "string") return null;
    if (type(test) == "int") return [5];
    return {"a": 5};
}

let a = null_or_object(1);

// Test 1: Direct property access after AND guard
let result = a != null && 5 in a;

// Test 2: Method call after AND guard
let hasProperty = a != null && length(keys(a)) > 0;

// Test 3: Nested AND guards
let value = a != null && type(a) == "object" && 5 in a;`;

  const testPath = path.join(__dirname, "temp-and-narrowing.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    console.log("Logical AND narrowing diagnostics:", diagnostics.map(d => ({
      message: d.message,
      line: d.range.start.line
    })));

    // Find lines with "in a" after &&
    const lines = content.split("\n");
    const andLines = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("&&") && lines[i].includes("in a")) {
        andLines.push(i);
      }
    }

    console.log(`Found ${andLines.length} lines with "&& ... in a"`);

    // Should have NO null diagnostics on any of these lines
    const nullDiagnosticsAfterAnd = diagnostics.filter(d =>
      d.message.includes("null") &&
      andLines.includes(d.range.start.line)
    );

    expect(nullDiagnosticsAfterAnd.length).toBe(0);
    console.log("✓ Logical AND narrowing verified: no null diagnostics after &&");

    // Test hover on the RHS of AND
    if (andLines.length > 0) {
      const firstAndLine = andLines[0];
      const lineText = lines[firstAndLine];
      const aPosition = lineText.lastIndexOf("a"); // Get "a" after &&

      const hover = await getHover(content, testPath, firstAndLine, aPosition);

      if (hover && hover.contents) {
        const hoverText = hover && hover.contents && typeof hover.contents === "string"
          ? hover.contents
          : (hover.contents.value || JSON.stringify(hover.contents));

        console.log("Hover after &&:", hoverText);

        if (!hoverText.includes("null")) {
          console.log("✓ Hover verified: null excluded from type after &&");
        }
      }
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should NOT narrow type in logical OR (||) expressions", async () => {
  const content = `function null_or_object(test) {
    if (type(test) == "string") return null;
    return {"a": 5};
}

let a = null_or_object(1);

// OR does not provide narrowing - if left is truthy, right is not evaluated
let result = a == null || 5 in a; // Should still show null error`;

  const testPath = path.join(__dirname, "temp-or-no-narrowing.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const lines = content.split("\n");
    const orLineNum = lines.findIndex(line => line.includes("|| 5 in a"));

    const nullDiagnostics = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === orLineNum
    );

    // OR should NOT narrow - should still have null diagnostic
    expect(nullDiagnostics.length).toBe(1);
    console.log("✓ OR does not narrow types (expected behavior)");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle multiple variables in AND expression", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);
let b = maybeNull(7);

// Both guards needed
let result = a != null && b != null && a.val + b.val;`;

  const testPath = path.join(__dirname, "temp-multi-var-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Multiple variable guards in AND work correctly");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle !== null (strict inequality)", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [x];
}

let a = maybeNull(3);

// Strict inequality should also narrow
let len = a !== null && length(a);`;

  const testPath = path.join(__dirname, "temp-strict-inequality.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Strict inequality (!==) narrows types correctly");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with null on left side (null != a)", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);

// Reversed order - null on left
let result = null != a && 5 in a;`;

  const testPath = path.join(__dirname, "temp-reversed-null-check.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    // Now supports reversed null checks
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Reversed null check (null != a) works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle deeply nested AND chains", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);

// Very deep nesting
let result = a != null && type(a) == "object" && "val" in a && a.val > 0 && a.val < 10;`;

  const testPath = path.join(__dirname, "temp-deep-and-chain.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Deeply nested AND chains narrow correctly");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in function call arguments", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

function process(val) {
    return val;
}

let a = maybeNull(3);

// AND expression as argument
let result = process(a != null && length(a));`;

  const testPath = path.join(__dirname, "temp-and-in-args.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in function arguments");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in return statements", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

function check(x) {
    let a = maybeNull(x);
    return a != null && a.val > 0;
}`;

  const testPath = path.join(__dirname, "temp-and-in-return.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in return statements");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in array literals", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

let arr = [
    a != null && length(a),
    42
];`;

  const testPath = path.join(__dirname, "temp-and-in-array.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in array literals");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in object literals", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);

let obj = {
    hasValue: a != null && "val" in a,
    other: 42
};`;

  const testPath = path.join(__dirname, "temp-and-in-object.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in object literals");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND with member expressions", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"nested": {"val": x}};
}

let a = maybeNull(3);

// Access nested properties after guard
let result = a != null && a.nested.val > 0;`;

  const testPath = path.join(__dirname, "temp-and-member-expr.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works with member expressions");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should NOT narrow in left side of AND", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": 1};
}

let a = maybeNull(3);

// 'a' in left side should still show null error
let result = "val" in a && a != null;`;

  const testPath = path.join(__dirname, "temp-no-narrow-left.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const lines = content.split("\n");
    const leftSideLineNum = lines.findIndex(line => line.includes('"val" in a'));

    const nullDiagnostics = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === leftSideLineNum
    );

    // Left side should still have null diagnostic
    expect(nullDiagnostics.length).toBeGreaterThan(0);
    console.log("✓ Left side of AND does not get narrowing (correct)");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND with different variable", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);
let b = maybeNull(7);

// Guard for 'a' should not affect 'b'
let result = a != null && "val" in b;`;

  const testPath = path.join(__dirname, "temp-and-wrong-var.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d =>
      d.message.includes("null") || d.message.includes("'in'")
    );

    // Should have error for 'b' since only 'a' is guarded
    expect(nullDiagnostics.length).toBeGreaterThan(0);
    console.log("✓ Guard for one variable does not affect others");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle parenthesized AND expressions", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

// Parenthesized expression
let result = (a != null) && length(a);`;

  const testPath = path.join(__dirname, "temp-parenthesized-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Parenthesized AND expressions narrow correctly");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in while loop condition", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

// While loop with AND guard
while (a != null && length(a) > 0) {
    break;
}`;

  const testPath = path.join(__dirname, "temp-and-while.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in while loop conditions");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in for loop condition", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);

// For loop with AND guard
for (let i = 0; a != null && i < length(a); i++) {
    print(i);
}`;

  const testPath = path.join(__dirname, "temp-and-for.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in for loop conditions");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle ternary with AND in condition", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);

// Ternary with AND - only use narrowing-safe operations
let result = a != null && a.val != null ? true : false;`;

  const testPath = path.join(__dirname, "temp-and-ternary.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in ternary conditions");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should preserve narrowing through else-if with AND", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

if (false) {
    print("no");
} else if (a != null && length(a) > 0) {
    print("yes");
}`;

  const testPath = path.join(__dirname, "temp-else-if-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works in else-if conditions");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle mixed AND with non-null operations", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);
let b = 5;

// Mix of null-check and regular operations
let result = a != null && b > 0 && length(a) > 0;`;

  const testPath = path.join(__dirname, "temp-mixed-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Mixed AND with null and non-null checks works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND with array access", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);

// Array access after guard
let result = a != null && a[0] > 0;`;

  const testPath = path.join(__dirname, "temp-and-array-access.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works with array access");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle multiple AND expressions in same scope", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);
let b = maybeNull(7);

// Multiple independent AND expressions
let r1 = a != null && length(a);
let r2 = b != null && length(b);`;

  const testPath = path.join(__dirname, "temp-multi-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Multiple independent AND expressions work");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should NOT leak narrowing outside AND expression", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

let inAnd = a != null && length(a);

// Outside the AND, 'a' should still be nullable
let afterAnd = 5 in a;`;

  const testPath = path.join(__dirname, "temp-no-leak-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const lines = content.split("\n");
    const afterAndLineNum = lines.findIndex(line => line.includes("let afterAnd"));

    const nullDiagnostics = diagnostics.filter(d =>
      d.message.includes("null") &&
      d.range.start.line === afterAndLineNum
    );

    // Should have null error outside the AND
    expect(nullDiagnostics.length).toBe(1);
    console.log("✓ Narrowing does not leak outside AND expression");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle complex nested structures with AND", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"data": {"items": [1, 2, 3]}};
}

let a = maybeNull(3);

// Complex nested access
let result = a != null &&
             "data" in a &&
             "items" in a.data &&
             length(a.data.items) > 0;`;

  const testPath = path.join(__dirname, "temp-complex-nested-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Complex nested structures with AND work");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND in assignment expressions", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);
let result;

// Assignment with AND
result = a != null && length(a);`;

  const testPath = path.join(__dirname, "temp-and-assignment.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND in assignment expressions works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle edge case: empty AND chain (just null check)", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

// Just the null check, no second operand using 'a'
let result = a != null && true;`;

  const testPath = path.join(__dirname, "temp-empty-and-chain.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Empty AND chain (no usage of guarded var) works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should combine else block and AND narrowing", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);

if (a == null) {
    print("null");
} else {
    // In else, a is already narrowed to non-null
    // AND should still work within this scope
    let result = type(a) == "object" && "val" in a;
}`;

  const testPath = path.join(__dirname, "temp-else-and-combo.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Combination of else block and AND narrowing works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle switch statement with AND in case", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);
let mode = "check";

switch (mode) {
    case "check":
        let result = a != null && length(a) > 0;
        break;
}`;

  const testPath = path.join(__dirname, "temp-switch-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND in switch case works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle AND with function calls that return nullable", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

function getArray() {
    return maybeNull(3);
}

let arr = getArray();

// Using a variable with AND works correctly
let result = arr != null && 5 in arr;`;

  const testPath = path.join(__dirname, "temp-and-func-call.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    // Should have no errors when using variable
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ AND narrowing works with variables from function calls");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle triple-nested AND expressions", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

// Triple nested: ((a != null && ...) && ...) && ...
let result = a != null && (a != null && (a != null && length(a)));`;

  const testPath = path.join(__dirname, "temp-triple-nested-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Triple-nested AND expressions work");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

// ===== HOVER VERIFICATION TESTS =====
// These tests verify that hover information correctly shows narrowed types

test("should show narrowed type in hover for simple AND", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);

// Before guard - should show null in type
let before = a;

// After AND guard - should NOT show null in type
let result = a != null && length(a);`;

  const testPath = path.join(__dirname, "temp-hover-simple-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    
    // Test hover BEFORE guard
    const beforeLine = lines.findIndex(line => line.includes("let before = a"));
    const beforeCol = lines[beforeLine].lastIndexOf("a");
    const hoverBefore = await getHover(content, testPath, beforeLine, beforeCol);
    
    const beforeText = typeof hoverBefore.contents === "string"
      ? hoverBefore.contents
      : (hoverBefore.contents.value || "");
    
    expect(beforeText).toContain("null");
    console.log("✓ Hover before guard shows null:", beforeText);
    
    // Test hover AFTER guard (in RHS of AND)
    const andLine = lines.findIndex(line => line.includes("&& length(a)"));
    const andCol = lines[andLine].lastIndexOf("a");
    const hoverAfter = await getHover(content, testPath, andLine, andCol);
    
    const afterText = typeof hoverAfter.contents === "string"
      ? hoverAfter.contents
      : (hoverAfter.contents.value || "");
    
    expect(afterText).not.toContain("null");
    console.log("✓ Hover after && excludes null:", afterText);

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover for nested AND", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"val": x};
}

let a = maybeNull(3);

let result = a != null && type(a) == "object" && a.val > 0;`;

  const testPath = path.join(__dirname, "temp-hover-nested-and.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const andLine = lines.findIndex(line => line.includes("a.val > 0"));
    const andCol = lines[andLine].indexOf("a.val");
    
    const hover = await getHover(content, testPath, andLine, andCol);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).not.toContain("null");
      console.log("✓ Nested AND hover excludes null:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover for multiple variables", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);
let b = maybeNull(7);

let result = a != null && b != null && length(a) + length(b);`;

  const testPath = path.join(__dirname, "temp-hover-multi-var.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const andLine = lines.findIndex(line => line.includes("length(a) + length(b)"));
    
    // Check hover on 'a'
    const aCol = lines[andLine].indexOf("length(a)") + 7; // Position of 'a' in length(a)
    const hoverA = await getHover(content, testPath, andLine, aCol);
    const hoverAText = typeof hoverA.contents === "string"
      ? hoverA.contents
      : (hoverA.contents.value || "");
    
    expect(hoverAText).not.toContain("null");
    console.log("✓ Variable 'a' hover excludes null:", hoverAText);
    
    // Check hover on 'b'
    const bCol = lines[andLine].indexOf("length(b)") + 7; // Position of 'b' in length(b)
    const hoverB = await getHover(content, testPath, andLine, bCol);
    const hoverBText = typeof hoverB.contents === "string"
      ? hoverB.contents
      : (hoverB.contents.value || "");
    
    expect(hoverBText).not.toContain("null");
    console.log("✓ Variable 'b' hover excludes null:", hoverBText);

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover within while loop", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);

while (a != null && 5 in a) {
    let val = a[0];
    break;
}`;

  const testPath = path.join(__dirname, "temp-hover-while.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const bodyLine = lines.findIndex(line => line.includes("let val"));
    const col = lines[bodyLine].indexOf("a[0]") + 1;

    const hover = await getHover(content, testPath, bodyLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).not.toContain("null");
      console.log("✓ While loop body hover excludes null:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover for array access", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);

let result = a != null && a[0] > 0;`;

  const testPath = path.join(__dirname, "temp-hover-array-access.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const andLine = lines.findIndex(line => line.includes("a[0]"));
    const col = lines[andLine].indexOf("a[0]");
    
    const hover = await getHover(content, testPath, andLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).not.toContain("null");
      console.log("✓ Array access hover excludes null:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover for member expression", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"nested": {"val": x}};
}

let a = maybeNull(3);

let result = a != null && a.nested.val > 0;`;

  const testPath = path.join(__dirname, "temp-hover-member.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const andLine = lines.findIndex(line => line.includes("a.nested"));
    const col = lines[andLine].indexOf("a.nested");
    
    const hover = await getHover(content, testPath, andLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).not.toContain("null");
      console.log("✓ Member expression hover excludes null:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should verify hover shows null OUTSIDE guard scope", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2];
}

let a = maybeNull(3);

let inGuard = a != null && length(a);

// This 'a' is outside the guard
let outside = a;`;

  const testPath = path.join(__dirname, "temp-hover-outside-guard.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    
    // Hover inside guard
    const insideLine = lines.findIndex(line => line.includes("&& length(a)"));
    const insideCol = lines[insideLine].lastIndexOf("a");
    const hoverInside = await getHover(content, testPath, insideLine, insideCol);
    const insideText = typeof hoverInside.contents === "string"
      ? hoverInside.contents
      : (hoverInside.contents.value || "");
    
    // Hover outside guard
    const outsideLine = lines.findIndex(line => line.includes("let outside = a"));
    const outsideCol = lines[outsideLine].lastIndexOf("a");
    const hoverOutside = await getHover(content, testPath, outsideLine, outsideCol);
    const outsideText = typeof hoverOutside.contents === "string"
      ? hoverOutside.contents
      : (hoverOutside.contents.value || "");
    
    expect(insideText).not.toContain("null");
    expect(outsideText).toContain("null");
    console.log("✓ Inside guard: null excluded:", insideText);
    console.log("✓ Outside guard: null included:", outsideText);

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover for complex nested structure", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : {"data": {"items": [1, 2, 3]}};
}

let a = maybeNull(3);

let result = a != null && "data" in a && a.data.items;`;

  const testPath = path.join(__dirname, "temp-hover-complex.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const andLine = lines.findIndex(line => line.includes("a.data.items"));
    const col = lines[andLine].indexOf("a.data");
    
    const hover = await getHover(content, testPath, andLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).not.toContain("null");
      console.log("✓ Complex nested hover excludes null:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with truthy guard (if (a))", async () => {
  const content = `function maybeNull(x) {
    return x > 5 ? null : [1, 2, 3];
}

let a = maybeNull(3);

// Truthy guard
if (a) {
    let len = length(a);
}`;

  const testPath = path.join(__dirname, "temp-truthy-guard.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));

    // Truthy guards should narrow out null
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Truthy guard (if (a)) works");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});


test("should narrow with type() guard", async () => {
  const content = `let a = getValue(); // Returns union type

if (type(a) == "object") {
    let val = a.property;
}`;

  const testPath = path.join(__dirname, "temp-type-guard.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);

    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null") || d.message.includes("undefined"));

    // Type guard should narrow to specific type
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type() guard narrows to specific type");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});


test("should narrow with type() == 'array'", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "array") {
    let val = a[0];
}`;

  const testPath = path.join(__dirname, "temp-type-array.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard (array) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with type() == 'string'", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "string") {
    let val = a + "suffix";
}`;

  const testPath = path.join(__dirname, "temp-type-string.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard (string) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with type() == 'int'", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "int") {
    let val = a + 5;
}`;

  const testPath = path.join(__dirname, "temp-type-int.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard (int) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with type() == 'double'", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "double") {
    let val = a + 5.5;
}`;

  const testPath = path.join(__dirname, "temp-type-double.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard (double) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with type() == 'bool'", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "bool") {
    let val = a ? 1 : 0;
}`;

  const testPath = path.join(__dirname, "temp-type-bool.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard (bool) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with type() == 'function'", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "function") {
    let result = a();
}`;

  const testPath = path.join(__dirname, "temp-type-function.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard (function) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show narrowed type in hover for type() guard", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "object") {
    let val = a.property;
}`;

  const testPath = path.join(__dirname, "temp-hover-type-guard.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const insideLine = lines.findIndex(line => line.includes("a.property"));
    const col = lines[insideLine].indexOf("a.property") + 1;
    
    const hover = await getHover(content, testPath, insideLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).toContain("object");
      expect(hoverText).not.toContain("null");
      console.log("✓ Hover shows narrowed type (object only):", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should NOT narrow with OR type guards", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

// OR doesn't narrow - need union type support for this
if (type(a) == "object" || type(a) == "array") {
    let val = 5 in a;
}`;

  const testPath = path.join(__dirname, "temp-type-or.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    
    // Currently OR doesn't narrow (expected limitation)
    expect(nullDiagnostics.length).toBeGreaterThan(0);
    console.log("✓ OR type guards don't narrow (expected limitation)");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow with reversed type() guard ('array' == type(a))", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if ("array" == type(a)) {
    let val = a[0];
}`;

  const testPath = path.join(__dirname, "temp-type-reversed.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d => d.message.includes("null"));
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Reversed type guard ('array' == type(a)) works");
  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show 'array' in hover for type() == 'array' guard", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "array") {
    let val = a[0];
}`;

  const testPath = path.join(__dirname, "temp-hover-array.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const insideLine = lines.findIndex(line => line.includes("a[0]"));
    const col = lines[insideLine].indexOf("a[0]") + 1;
    
    const hover = await getHover(content, testPath, insideLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).toContain("array");
      expect(hoverText).not.toContain("null");
      console.log("✓ Hover shows 'array' only:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show 'string' in hover for type() == 'string' guard", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "string") {
    let val = a + "suffix";
}`;

  const testPath = path.join(__dirname, "temp-hover-string.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const insideLine = lines.findIndex(line => line.includes("a + "));
    const col = lines[insideLine].indexOf("a + ") + 1;

    const hover = await getHover(content, testPath, insideLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).toContain("string");
      expect(hoverText).not.toContain("null");
      console.log("✓ Hover shows 'string' only:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should show 'integer' in hover for type() == 'int' guard", async () => {
  const content = `function getValue() {
    return null;
}

let a = getValue();

if (type(a) == "int") {
    let val = a + 5;
}`;

  const testPath = path.join(__dirname, "temp-hover-int.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");
    const insideLine = lines.findIndex(line => line.includes("a + 5"));
    const col = lines[insideLine].indexOf("a + 5") + 1;
    
    const hover = await getHover(content, testPath, insideLine, col);

    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === "string"
        ? hover.contents
        : (hover.contents.value || "");

      expect(hoverText).toContain("integer");
      expect(hoverText).not.toContain("null");
      console.log("✓ Hover shows 'integer' only:", hoverText);
    } else {
      console.log("⚠ Hover returned null - skipping check");
    }

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should suppress diagnostics after type() narrows to 'object'", async () => {
  const content = `function null_or_object(test) {
    if (type(test) == 'string') {
        return null;
    }
    if (type(test) == 'int') {
        return [5];
    }
    return {"a": 5};
}

let a = null_or_object(1);

if (type(a) == 'object') {
    if (5 in a) {
        print("lol");
    }
}`;

  const testPath = path.join(__dirname, "temp-type-object-diagnostic.uc");
  fs.writeFileSync(testPath, content);

  try {
    const diagnostics = await getDiagnostics(content, testPath);
    const nullDiagnostics = diagnostics.filter(d =>
      d.message.includes("null") || d.message.includes("possibly")
    );

    // After narrowing to 'object', no null/possibly diagnostics should appear
    expect(nullDiagnostics.length).toBe(0);
    console.log("✓ Type guard suppresses diagnostics for narrowed operations");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow type in switch statement based on type() discriminant", async () => {
  const content = `function array_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    return [5];
}

let d = array_or_object(0);

switch(type(d))
{
    case 'object':
        print(d);
        break;
    case 'array':
        print(d);
        break;
    default:
        print(d);
        break;
}`;

  const testPath = path.join(__dirname, "temp-switch-type-discriminant.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");

    // Find the three print(d) statements
    const objectCaseLine = lines.findIndex((line, idx) => {
      return line.includes("case 'object':") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    const arrayCaseLine = lines.findIndex((line, idx) => {
      return line.includes("case 'array':") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    const defaultCaseLine = lines.findIndex((line, idx) => {
      return line.includes("default:") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    // Check hover in 'object' case
    const objectCol = lines[objectCaseLine].indexOf("d");
    const objectHover = await getHover(content, testPath, objectCaseLine, objectCol);
    const objectHoverText = typeof objectHover?.contents === "string"
      ? objectHover.contents
      : (objectHover?.contents?.value || "");

    console.log(`Object case hover (line ${objectCaseLine}):`, objectHoverText);
    expect(objectHoverText).toContain("object");
    expect(objectHoverText).not.toContain("array");

    // Check hover in 'array' case
    const arrayCol = lines[arrayCaseLine].indexOf("d");
    const arrayHover = await getHover(content, testPath, arrayCaseLine, arrayCol);
    const arrayHoverText = typeof arrayHover?.contents === "string"
      ? arrayHover.contents
      : (arrayHover?.contents?.value || "");

    console.log(`Array case hover (line ${arrayCaseLine}):`, arrayHoverText);
    expect(arrayHoverText).toContain("array");
    expect(arrayHoverText).not.toContain("object");

    // Check hover in default case - should show remaining types after narrowing out object and array
    const defaultCol = lines[defaultCaseLine].indexOf("d");
    const defaultHover = await getHover(content, testPath, defaultCaseLine, defaultCol);
    const defaultHoverText = typeof defaultHover?.contents === "string"
      ? defaultHover.contents
      : (defaultHover?.contents?.value || "");

    console.log(`Default case hover (line ${defaultCaseLine}):`, defaultHoverText);
    // Default should show unknown/null or be empty since all possible types are covered
    expect(defaultHoverText).not.toContain("object");
    expect(defaultHoverText).not.toContain("array");

    console.log("✓ Switch statement narrows types based on type() discriminant");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle switch fall-through with explicit case bodies", async () => {
  const content = `function array_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    return [5];
}

let d = array_or_object(0);

switch(type(d))
{
    case 'object':
        print(d, "object");
    case 'array':
        print(d, "array");
    default:
        print(d);
        break;
}`;

  const testPath = path.join(__dirname, "temp-switch-true-fallthrough.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");

    // Find each print statement
    let objectPrintLine = -1;
    let arrayPrintLine = -1;
    let defaultPrintLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('case \'object\':')) {
        objectPrintLine = i + 1;
      } else if (lines[i].includes('case \'array\':')) {
        arrayPrintLine = i + 1;
      } else if (lines[i].includes('default:')) {
        defaultPrintLine = i + 1;
      }
    }

    // Check hover in object case - should be just object
    const objectCol = lines[objectPrintLine].indexOf("d");
    const objectHover = await getHover(content, testPath, objectPrintLine, objectCol);
    const objectHoverText = typeof objectHover?.contents === "string"
      ? objectHover.contents
      : (objectHover?.contents?.value || "");

    console.log(`Object case (no break) hover (line ${objectPrintLine}):`, objectHoverText);
    expect(objectHoverText).toContain("object");
    expect(objectHoverText).not.toContain("array");

    // Check hover in array case - should be object | array (can reach from object fallthrough OR array match)
    const arrayCol = lines[arrayPrintLine].indexOf("d");
    const arrayHover = await getHover(content, testPath, arrayPrintLine, arrayCol);
    const arrayHoverText = typeof arrayHover?.contents === "string"
      ? arrayHover.contents
      : (arrayHover?.contents?.value || "");

    console.log(`Array case (with fallthrough) hover (line ${arrayPrintLine}):`, arrayHoverText);
    expect(arrayHoverText).toContain("array");
    expect(arrayHoverText).toContain("object");

    // Check hover in default case - should be object | array (all cases fall through)
    const defaultCol = lines[defaultPrintLine].indexOf("d");
    const defaultHover = await getHover(content, testPath, defaultPrintLine, defaultCol);
    const defaultHoverText = typeof defaultHover?.contents === "string"
      ? defaultHover.contents
      : (defaultHover?.contents?.value || "");

    console.log(`Default case (with fallthrough from all) hover (line ${defaultPrintLine}):`, defaultHoverText);
    expect(defaultHoverText).toContain("array");
    expect(defaultHoverText).toContain("object");

    console.log("✓ Switch fall-through with explicit bodies shows correct type widening");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle switch fall-through with empty cases", async () => {
  const content = `function multi_type(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    if (type(test) == 'string') {
        return [5];
    }
    return "str";
}

let d = multi_type(0);

switch(type(d))
{
    case 'object':
    case 'array':
        // Both object and array fall through here - type should be object | array
        print(d);
        break;
    case 'string':
        print(d);
        break;
}`;

  const testPath = path.join(__dirname, "temp-switch-empty-fallthrough.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");

    // Find the print(d) in the fall-through section
    const fallthroughLine = lines.findIndex((line, idx) => {
      return line.includes("Both object and array") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    const stringLine = lines.findIndex((line, idx) => {
      return line.includes("case 'string':") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    // Check hover in fall-through case - should show object | array
    const fallthroughCol = lines[fallthroughLine].indexOf("d");
    const fallthroughHover = await getHover(content, testPath, fallthroughLine, fallthroughCol);
    const fallthroughHoverText = typeof fallthroughHover?.contents === "string"
      ? fallthroughHover.contents
      : (fallthroughHover?.contents?.value || "");

    console.log(`Empty fall-through case hover (line ${fallthroughLine}):`, fallthroughHoverText);
    expect(fallthroughHoverText).toContain("array");
    expect(fallthroughHoverText).toContain("object");

    // Check hover in string case
    const stringCol = lines[stringLine].indexOf("d");
    const stringHover = await getHover(content, testPath, stringLine, stringCol);
    const stringHoverText = typeof stringHover?.contents === "string"
      ? stringHover.contents
      : (stringHover?.contents?.value || "");

    console.log(`String case hover (line ${stringLine}):`, stringHoverText);
    expect(stringHoverText).toContain("string");
    expect(stringHoverText).not.toContain("object");
    expect(stringHoverText).not.toContain("array");

    console.log("✓ Switch empty case fall-through shows union type");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should narrow default case when not all types are handled", async () => {
  const content = `function multi_type(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    if (type(test) == 'string') {
        return [5];
    }
    return "str";
}

let d = multi_type(0);

switch(type(d))
{
    case 'object':
        print(d);
        break;
    default:
        // Should narrow to array | string (everything except object)
        print(d);
        break;
}`;

  const testPath = path.join(__dirname, "temp-switch-partial-default.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");

    const objectLine = lines.findIndex((line, idx) => {
      return line.includes("case 'object':") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    const defaultLine = lines.findIndex((line, idx) => {
      return line.includes("// Should narrow") && lines[idx + 1]?.includes("print(d)");
    }) + 1;

    // Check hover in object case
    const objectCol = lines[objectLine].indexOf("d");
    const objectHover = await getHover(content, testPath, objectLine, objectCol);
    const objectHoverText = typeof objectHover?.contents === "string"
      ? objectHover.contents
      : (objectHover?.contents?.value || "");

    console.log(`Object case hover (line ${objectLine}):`, objectHoverText);
    expect(objectHoverText).toContain("object");
    expect(objectHoverText).not.toContain("array");
    expect(objectHoverText).not.toContain("string");

    // Check hover in default case - should show array | string (not object)
    const defaultCol = lines[defaultLine].indexOf("d");
    const defaultHover = await getHover(content, testPath, defaultLine, defaultCol);
    const defaultHoverText = typeof defaultHover?.contents === "string"
      ? defaultHover.contents
      : (defaultHover?.contents?.value || "");

    console.log(`Default case hover (line ${defaultLine}):`, defaultHoverText);
    expect(defaultHoverText).toContain("array");
    expect(defaultHoverText).toContain("string");
    expect(defaultHoverText).not.toContain("object");

    console.log("✓ Default case correctly narrows to remaining types");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});

test("should handle default case with fall-through and unhandled types", async () => {
  const content = `function array_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    if (type(test) == "double") {
        return null;
    }
    return [5];
}

let d = array_or_object(5.0);

switch(type(d))
{
    case 'object':
        print(d, "object");
    case 'array':
        print(d, "array");
    default:
        print(d, " default");
        break;
}`;

  const testPath = path.join(__dirname, "temp-switch-default-fallthrough-unhandled.uc");
  fs.writeFileSync(testPath, content);

  try {
    const lines = content.split("\n");

    // Find each print statement
    let objectPrintLine = -1;
    let arrayPrintLine = -1;
    let defaultPrintLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('case \'object\':')) {
        objectPrintLine = i + 1;
      } else if (lines[i].includes('case \'array\':')) {
        arrayPrintLine = i + 1;
      } else if (lines[i].includes('default:')) {
        defaultPrintLine = i + 1;
      }
    }

    // Check hover in object case - should be just object
    const objectCol = lines[objectPrintLine].indexOf("d");
    const objectHover = await getHover(content, testPath, objectPrintLine, objectCol);
    const objectHoverText = typeof objectHover?.contents === "string"
      ? objectHover.contents
      : (objectHover?.contents?.value || "");

    console.log(`Object case (no break) hover (line ${objectPrintLine}):`, objectHoverText);
    expect(objectHoverText).toContain("object");
    expect(objectHoverText).not.toContain("array");
    expect(objectHoverText).not.toContain("null");

    // Check hover in array case - should be object | array (fall-through from object)
    const arrayCol = lines[arrayPrintLine].indexOf("d");
    const arrayHover = await getHover(content, testPath, arrayPrintLine, arrayCol);
    const arrayHoverText = typeof arrayHover?.contents === "string"
      ? arrayHover.contents
      : (arrayHover?.contents?.value || "");

    console.log(`Array case (with fallthrough) hover (line ${arrayPrintLine}):`, arrayHoverText);
    expect(arrayHoverText).toContain("array");
    expect(arrayHoverText).toContain("object");
    expect(arrayHoverText).not.toContain("null");

    // Check hover in default case - should be object | array | null
    // (fall-through from object/array + unhandled null type)
    const defaultCol = lines[defaultPrintLine].indexOf("d");
    const defaultHover = await getHover(content, testPath, defaultPrintLine, defaultCol);
    const defaultHoverText = typeof defaultHover?.contents === "string"
      ? defaultHover.contents
      : (defaultHover?.contents?.value || "");

    console.log(`Default case (with fallthrough + unhandled) hover (line ${defaultPrintLine}):`, defaultHoverText);
    expect(defaultHoverText).toContain("array");
    expect(defaultHoverText).toContain("object");
    expect(defaultHoverText).toContain("null");

    console.log("✓ Default case with fall-through correctly includes unhandled types");

  } finally {
    if (fs.existsSync(testPath)) {
      fs.unlinkSync(testPath);
    }
  }
});
