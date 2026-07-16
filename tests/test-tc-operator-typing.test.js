// Operator-typing fixes from the --type-coverage audit (2026-07-07):
//
//  1. docs/tc-compound-assign-operator-typing.md — `x op= y` must type as
//     `typeof(x_old op y)`, not the bare RHS. ucode's update opcodes route
//     through the SAME uc_vm_value_arith as the binary operators (vendored
//     ucode/vm.c: uc_vm_insn_update_var/_upval/_local/_val), so `s += 1` on a
//     string must stay `string` (concat), `d -= 1` on a double must stay
//     `double`, and `x ??= y` / `x ||= y` / `x &&= y` must follow the same
//     result-type rules as their binary forms (verified against
//     ucode/compiler.c's short-circuit compile shapes for `??=`/`||=`/`&&=`).
//  2. docs/tc-arith-unknown-operand-numeric.md — `- * / % **` on an unknown
//     operand soundly narrow to `integer | double` (vm.c's uc_vm_value_arith
//     has NO string-concat case for anything except I_ADD, so every other
//     arithmetic opcode is guaranteed numeric regardless of operand type).
//     `+` keeps `unknown` (a string operand would concatenate instead).
//  3. docs/tc-unary-operator-union-collapse.md — unary `+ - ++ -- ~` now
//     distribute over a union operand member-by-member instead of collapsing
//     to a blanket `unknown` (mirrors arithmeticTypeInference.distribute for
//     the binary case).
//
// Driven through the real LSP server (handleHover), matching the convention
// in tests/inference/test-arithmetic-inference.mocha.js and
// tests/test-tc-forin-keys.test.js.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// Hover the token at the LAST occurrence of `needle` in `code`, returning the
// full markdown hover text (e.g. "(variable) **x**: `string`").
async function hoverAt(code, needle) {
  const idx = code.lastIndexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle}`);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const uri = `/tmp/tc-op-typing-${n++}.uc`;
  await server.getDiagnostics(code, uri); // settle full analysis before hovering
  const h = await server.getHover(code, uri, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}

// Exact type string (the backtick-quoted segment of the hover), for strict
// equality assertions (e.g. "integer | double", not just `.toContain`).
function exactType(hoverText) {
  const m = hoverText.match(/`([^`]+)`/);
  return m ? m[1].trim() : hoverText.trim();
}
async function typeAt(code, needle) {
  return exactType(await hoverAt(code, needle));
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Compound assignment operator typing
// ─────────────────────────────────────────────────────────────────────────

test('01 s += 1 on a string stays string (concat), not integer', async () => {
  const code = 'let s = "x";\ns += 1;\nlet sCheck = s;\n';
  expect(await typeAt(code, 'sCheck =')).toBe('string');
});

test('02 d -= 1 on a double stays double, not integer', async () => {
  const code = 'let d = 1.5;\nd -= 1;\nlet dCheck = d;\n';
  expect(await typeAt(code, 'dCheck =')).toBe('double');
});

test('03 n *= 2 on an integer stays integer', async () => {
  const code = 'let n = 4;\nn *= 2;\nlet nCheck = n;\n';
  expect(await typeAt(code, 'nCheck =')).toBe('integer');
});

test('04 x ??= 5 on string|null preserves the left type: string | integer', async () => {
  const code = 'function f(flag) {\n  let x = flag ? "s" : null;\n  x ??= 5;\n  let xCheck = x;\n}\n';
  const t = await typeAt(code, 'xCheck =');
  expect(t).toContain('string');
  expect(t).toContain('integer');
  expect(t).not.toMatch(/\bunknown\b/);
});

test('05 x ??= 5 on a provably-non-null left is left unchanged (right unreachable)', async () => {
  const code = 'let x = "s";\nx ??= 5;\nlet xCheck = x;\n';
  expect(await typeAt(code, 'xCheck =')).toBe('string');
});

test('06 y ||= 42 on a string: matches binary `y || 42` exactly (string | integer)', async () => {
  // A general STRING base isn't provably truthy (empty string is falsy), so
  // the sound (non-literal-value-aware) result is a union — same answer the
  // binary `||` operator already gives for the identical inputs.
  const code = 'let y = "hello";\ny ||= 42;\nlet yCheck = y;\n';
  const compound = await typeAt(code, 'yCheck =');
  const binaryCode = 'let y = "hello";\nlet yCheck = y || 42;\n';
  const binary = await typeAt(binaryCode, 'yCheck =');
  expect(compound).toBe(binary);
  expect(compound).toContain('string');
  expect(compound).toContain('integer');
});

test('07 z &&= expr on array (always truthy) always takes the right operand', async () => {
  const code = 'let z = [1];\nz &&= "s";\nlet zCheck = z;\n';
  expect(await typeAt(code, 'zCheck =')).toBe('string');
});

test('08 b |= 1 (bitwise compound) is always integer', async () => {
  const code = 'let b = true;\nb |= 1;\nlet bCheck = b;\n';
  expect(await typeAt(code, 'bCheck =')).toBe('integer');
});

test('09 c /= 0 (literal-zero division, compound) is double (Infinity/NaN), not integer', async () => {
  const code = 'let c = 4;\nc /= 0;\nlet cCheck = c;\n';
  expect(await typeAt(code, 'cCheck =')).toBe('double');
});

test('10 param += 1 with an untyped operand stays unknown (unaffected — `+` may concat)', async () => {
  const code = 'function f(p) {\n  p += 1;\n  let pCheck = p;\n}\n';
  expect(await typeAt(code, 'pCheck =')).toBe('unknown');
});

test('11 param -= 1 with an untyped operand narrows to integer | double (compound routes through the arith-unknown fix)', async () => {
  const code = 'function f(p) {\n  p -= 1;\n  let pCheck = p;\n}\n';
  const t = await typeAt(code, 'pCheck =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
  expect(t).not.toMatch(/\bunknown\b/);
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Arithmetic on an unknown operand: `- * / % **` → integer | double
// ─────────────────────────────────────────────────────────────────────────

test('12 unknown - 1 → integer | double', async () => {
  const code = 'function f(u) {\n  let c = u - 1;\n}\n';
  const t = await typeAt(code, 'c =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
  expect(t).not.toMatch(/\bunknown\b/);
});

test('13 unknown * 2 → integer | double', async () => {
  const code = 'function f(u) {\n  let c = u * 2;\n}\n';
  const t = await typeAt(code, 'c =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});

test('14 unknown % 3 → integer | double', async () => {
  const code = 'function f(u) {\n  let c = u % 3;\n}\n';
  const t = await typeAt(code, 'c =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});

test('15 unknown ** 2 → integer | double', async () => {
  const code = 'function f(u) {\n  let c = u ** 2;\n}\n';
  const t = await typeAt(code, 'c =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});

test('16 unknown / 1 → integer | double', async () => {
  const code = 'function f(u) {\n  let c = u / 1;\n}\n';
  const t = await typeAt(code, 'c =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});

test('17 unknown + 1 stays unknown (deferred — could still be a string that concatenates)', async () => {
  const code = 'function f(u) {\n  let c = u + 1;\n}\n';
  expect(await typeAt(code, 'c =')).toBe('unknown');
});

test('18 unknown / null is still double (literal divide-by-null rule, unaffected by the unknown-operand fix)', async () => {
  const code = 'function f(u) {\n  let c = u / null;\n}\n';
  expect(await typeAt(code, 'c =')).toBe('double');
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Unary operators distribute over a union operand instead of collapsing
//    to `unknown`.
// ─────────────────────────────────────────────────────────────────────────

test('19 -x on integer|null → integer (every member coerces to integer)', async () => {
  const code = 'function f(flag) {\n  let x = flag ? 5 : null;\n  let neg = -x;\n}\n';
  expect(await typeAt(code, 'neg =')).toBe('integer');
});

test('20 +x on integer|null → integer', async () => {
  const code = 'function f(flag) {\n  let x = flag ? 5 : null;\n  let plus = +x;\n}\n';
  expect(await typeAt(code, 'plus =')).toBe('integer');
});

test('21 ~x on integer|null → integer (bitwise complement always integer)', async () => {
  const code = 'function f(flag) {\n  let x = flag ? 5 : null;\n  let notted = ~x;\n}\n';
  expect(await typeAt(code, 'notted =')).toBe('integer');
});

test('22 ++x / --x on integer|null → integer', async () => {
  const code = 'function f(flag) {\n  let x = flag ? 5 : null;\n  let inc = ++x;\n}\n';
  expect(await typeAt(code, 'inc =')).toBe('integer');
});

test('23 -x on string|null → integer | double (string coerces to int|double, null coerces to integer)', async () => {
  const code = 'function f(flag) {\n  let x = flag ? "5" : null;\n  let neg = -x;\n}\n';
  const t = await typeAt(code, 'neg =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});

test('24 unary - on a genuinely unknown (unannotated param) → integer | double', async () => {
  const code = 'function f(p) {\n  let neg = -p;\n}\n';
  const t = await typeAt(code, 'neg =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
  expect(t).not.toMatch(/\bunknown\b/);
});

test('25 unary ~ on a genuinely unknown (unannotated param) → integer (never unknown)', async () => {
  const code = 'function f(p) {\n  let notted = ~p;\n}\n';
  expect(await typeAt(code, 'notted =')).toBe('integer');
});

test('26 -x on integer|string (real union, both members non-null) → integer | double', async () => {
  const code = 'function f(flag) {\n  let x = flag ? 5 : "y";\n  let neg = -x;\n}\n';
  const t = await typeAt(code, 'neg =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});
