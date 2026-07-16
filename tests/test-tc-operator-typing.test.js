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

// ─────────────────────────────────────────────────────────────────────────
// 4. `**` exponentiation: a NEGATIVE integer exponent yields a double.
//    ucode/vm.c:1797 (I_EXP): two integers with exp < 0 → `1.0/base^|exp|`
//    (double); exp >= 0 → integer. This is the one arithmetic op where
//    int**int can be non-integer. docs/tc-exponent-negative-double.md
// ─────────────────────────────────────────────────────────────────────────

test('27 x ** -1 on an integer is double (negative exponent), not integer', async () => {
  const code = 'let x = 2;\nlet r = x ** -1;\n';
  expect(await typeAt(code, 'r =')).toBe('double');
});

test('28 x **= -1 on an integer becomes double (compound routes through the same fix)', async () => {
  const code = 'let x = 2;\nx **= -1;\nlet xCheck = x;\n';
  expect(await typeAt(code, 'xCheck =')).toBe('double');
});

test('29 x ** 2 on an integer stays integer (non-negative literal exponent)', async () => {
  const code = 'let x = 2;\nlet r = x ** 2;\n';
  expect(await typeAt(code, 'r =')).toBe('integer');
});

test('30 x ** y with an unknown-sign exponent → integer | double', async () => {
  const code = 'function f(y) {\n  let x = 2;\n  let r = x ** y;\n}\n';
  const t = await typeAt(code, 'r =');
  expect(t).toContain('integer');
  expect(t).toContain('double');
});

test('31 double base ** -1 stays double (unaffected by the fix)', async () => {
  const code = 'let x = 2.0;\nlet r = x ** -1;\n';
  expect(await typeAt(code, 'r =')).toBe('double');
});

// ─────────────────────────────────────────────────────────────────────────
// 5. UC2014 (Information): explain the `**` type inference. A warning would be
//    wrong (`**` is valid for any operand), so the non-obvious "negative
//    exponent -> double" inference is surfaced as an INFO note.
//    docs/tc-exponent-negative-double.md
// ─────────────────────────────────────────────────────────────────────────

async function uc2014(code) {
  const uri = `/tmp/tc-op-2014-${n++}.uc`;
  const ds = await server.getDiagnostics(code, uri);
  return ds.filter(d => d.code === 'UC2014');
}

test('32 UC2014 fires (Information) on x ** -1 — negative literal exponent', async () => {
  const notes = await uc2014('let x = 2;\nlet r = x ** -1;\n');
  expect(notes.length).toBe(1);
  expect(notes[0].severity).toBe(3);                 // DiagnosticSeverity.Information
  expect(notes[0].message).toContain('negative exponent');
});

test('33 UC2014 fires on x ** exp (unknown sign) — integer | double', async () => {
  const notes = await uc2014('function f(exp) { let x = 2; return x ** exp; }\nlet e = f;\n');
  expect(notes.length).toBe(1);
  expect(notes[0].message).toContain('integer | double');
});

test('34 UC2014 fires on the compound form x **= -1', async () => {
  const notes = await uc2014('let x = 2;\nx **= -1;\n');
  expect(notes.length).toBe(1);
  expect(notes[0].severity).toBe(3);
});

test('35 UC2014 stays SILENT on x ** 2 (obvious integer)', async () => {
  expect((await uc2014('let x = 2;\nlet r = x ** 2;\n')).length).toBe(0);
});

test('36 UC2014 stays SILENT on a double base (2.0 ** 2) — no exponent surprise', async () => {
  expect((await uc2014('let x = 2.0;\nlet r = x ** 2;\n')).length).toBe(0);
});

test('37 UC2014 stays SILENT on a double base with a negative exponent (2.0 ** -1) — double comes from the base, not the exponent', async () => {
  expect((await uc2014('let x = 2.0;\nlet r = x ** -1;\n')).length).toBe(0);
});
