// Test that hover correctly resolves local vs global variables when they share the same name.
// Regression tests for the hover scope resolution bug where the CFG or global symbol table
// would override a local variable's type with the global's type.

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

function extractHoverType(hover) {
  if (!hover || !hover.contents) return '';
  const text = hover.contents.value || '';
  // Extract the type from patterns like: (variable) **name**: `type`
  const match = text.match(/`([^`]+)`/);
  return match ? match[1] : text;
}

function extractHoverText(hover) {
  if (!hover || !hover.contents) return '';
  return hover.contents.value || '';
}

describe('Hover Scope Resolution', function() {
  this.timeout(15000);

  let lspServer, getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  const testFile = '/tmp/test-hover-scope.uc';

  // ── 1. Local variable shadows global with different type ──────────
  it('should show local type, not global, for same-named variable', async function() {
    const code = `let x = "hello";

function foo(n) {
	let x = 42;
	print(x);
}
print(x);
`;
    // Hover over x in print(x) inside foo — line 4, char 7
    const localHover = await getHover(code, testFile, 4, 7);
    assert.ok(extractHoverType(localHover).includes('integer'),
      `Local x should be integer, got: ${extractHoverType(localHover)}`);

    // Hover over x in print(x) at global scope — line 6, char 6
    const globalHover = await getHover(code, testFile, 6, 6);
    assert.ok(extractHoverType(globalHover).includes('string'),
      `Global x should be string, got: ${extractHoverType(globalHover)}`);
  });

  // ── 2. split() return type: local unknown vs global known ─────────
  it('should show array | null for split(unknown) even when global split(string) exists', async function() {
    const code = `function process(x) {
	let parts = split(x, ',');
	print(parts);
}

let input = "a,b,c";
let parts = split(input, ',');
print(parts);
`;
    // local parts inside process() — line 2, char 7
    const localHover = await getHover(code, testFile, 2, 7);
    const localType = extractHoverType(localHover);
    assert.ok(localType.includes('null'),
      `Local parts should be array | null, got: ${localType}`);

    // global parts — line 7, char 6
    const globalHover = await getHover(code, testFile, 7, 6);
    const globalType = extractHoverType(globalHover);
    assert.ok(globalType.includes('array'),
      `Global parts should be array<string>, got: ${globalType}`);
  });

  // ── 3. Parameter shadows global variable ──────────────────────────
  it('should show parameter type, not global type', async function() {
    const code = `let name = "global";

function greet(name) {
	print(name);
}
`;
    // hover on 'name' in print(name) — line 3, char 7
    const hover = await getHover(code, testFile, 3, 7);
    const text = extractHoverText(hover);
    // Should show parameter, not the global string
    assert.ok(text.includes('parameter') || text.includes('unknown'),
      `Should show parameter, got: ${text}`);
  });

  // ── 4. Nested function scopes ─────────────────────────────────────
  it('should resolve correct scope in nested functions', async function() {
    const code = `let val = "string";

function outer() {
	let val = 42;
	function inner() {
		let val = true;
		print(val);
	}
	print(val);
}
print(val);
`;
    // inner val (line 6, char 8) — boolean
    const innerHover = await getHover(code, testFile, 6, 8);
    assert.ok(extractHoverType(innerHover).includes('boolean'),
      `Inner val should be boolean, got: ${extractHoverType(innerHover)}`);

    // outer val (line 8, char 7) — integer
    const outerHover = await getHover(code, testFile, 8, 7);
    assert.ok(extractHoverType(outerHover).includes('integer'),
      `Outer val should be integer, got: ${extractHoverType(outerHover)}`);

    // global val (line 10, char 6) — string
    const globalHover = await getHover(code, testFile, 10, 6);
    assert.ok(extractHoverType(globalHover).includes('string'),
      `Global val should be string, got: ${extractHoverType(globalHover)}`);
  });

  // ── 5. Local array vs global string ───────────────────────────────
  it('should not confuse array local with string global', async function() {
    const code = `let data = "text";

function process() {
	let data = [1, 2, 3];
	let n = length(data);
	print(n);
}
`;
    // hover over 'data' in length(data) — line 4, char 16
    const hover = await getHover(code, testFile, 4, 16);
    assert.ok(extractHoverType(hover).includes('array'),
      `Local data should be array, got: ${extractHoverType(hover)}`);
  });

  // ── 6. Object property hover with same-named local ────────────────
  it('should resolve object property types from local, not global', async function() {
    const code = `const obj = {
	name: 'global_obj',
	value: 100,
};

function test() {
	const obj = {
		name: 'local_obj',
		value: true,
	};
	print(obj.value);
}
`;
    // hover over 'value' in obj.value — line 10, char 12
    const hover = await getHover(code, testFile, 10, 12);
    const hoverType = extractHoverType(hover);
    assert.ok(hoverType.includes('boolean'),
      `Local obj.value should be boolean, got: ${hoverType}`);
  });

  // ── 7. Function return type: local vs global ──────────────────────
  it('should show local function return type correctly', async function() {
    const code = `function helper() {
	return "global";
}

function outer() {
	function helper() {
		return 42;
	}
	let result = helper();
	print(result);
}
`;
    // hover over 'result' — line 9, char 7
    const hover = await getHover(code, testFile, 9, 7);
    const resultType = extractHoverType(hover);
    assert.ok(resultType.includes('integer'),
      `Local helper() result should be integer, got: ${resultType}`);
  });

  // ── 8. Variable at declaration vs usage ───────────────────────────
  it('should show same type at declaration and usage for local var', async function() {
    const code = `let count = "not a number";

function work() {
	let count = length([1,2,3]);
	print(count);
}
`;
    // hover over 'count' at declaration (line 3, char 5)
    const declHover = await getHover(code, testFile, 3, 5);
    const declType = extractHoverType(declHover);

    // hover over 'count' at usage (line 4, char 7)
    const useHover = await getHover(code, testFile, 4, 7);
    const useType = extractHoverType(useHover);

    assert.strictEqual(declType, useType,
      `Declaration type (${declType}) should match usage type (${useType})`);
    assert.ok(declType.includes('integer'),
      `count should be integer, got: ${declType}`);
  });

  // ── 9. Multiple functions with same local name ────────────────────
  it('should resolve correct type in each function independently', async function() {
    const code = `function alpha() {
	let tmp = "hello";
	print(tmp);
}

function beta() {
	let tmp = 42;
	print(tmp);
}

function gamma() {
	let tmp = [1, 2];
	print(tmp);
}
`;
    // tmp in alpha (line 2, char 7) — string
    const h1 = await getHover(code, testFile, 2, 7);
    assert.ok(extractHoverType(h1).includes('string'),
      `alpha tmp should be string, got: ${extractHoverType(h1)}`);

    // tmp in beta (line 7, char 7) — integer
    const h2 = await getHover(code, testFile, 7, 7);
    assert.ok(extractHoverType(h2).includes('integer'),
      `beta tmp should be integer, got: ${extractHoverType(h2)}`);

    // tmp in gamma (line 12, char 7) — array
    const h3 = await getHover(code, testFile, 12, 7);
    assert.ok(extractHoverType(h3).includes('array'),
      `gamma tmp should be array, got: ${extractHoverType(h3)}`);
  });

  // ── 10. Builtin return type narrowing with local shadow ───────────
  it('should show narrowed builtin return type for local var, not global', async function() {
    const code = `let idx = index("hello", "l");

function search(x) {
	let idx = index(x, "needle");
	print(idx);
}
`;
    // global idx — should be integer (known string args)
    const globalHover = await getHover(code, testFile, 0, 4);
    const globalType = extractHoverType(globalHover);
    assert.ok(globalType.includes('integer'),
      `Global idx should be integer, got: ${globalType}`);

    // local idx in search() — should include null (unknown first arg)
    const localHover = await getHover(code, testFile, 4, 7);
    const localType = extractHoverType(localHover);
    assert.ok(localType.includes('integer') || localType.includes('null') || localType.includes('unknown'),
      `Local idx should reflect unknown arg type, got: ${localType}`);
  });
});
