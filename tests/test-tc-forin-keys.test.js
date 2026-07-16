// Two-variable `for (k, v in x)`: the KEY variable, union-aware and sound even for a
// completely unknown iterable (docs/tc-forin-two-var-key-type.md).
//
// Per vendored ucode vm.c (`uc_vm_insn_next` / `uc_vm_object_iterator_next` /
// `uc_vm_array_iterator_next`): only UC_OBJECT and UC_ARRAY iterate at all (the
// switch's `default:` breaks straight to pushing null/null — the loop body never
// runs for any other value). Object iteration always pushes a string key; array
// iteration always pushes an integer index. So the key is `string | integer` even
// when the iterable's own type is `unknown` — if the body executes, the iterable
// was provably an object or an array. This extends the 0.6.189 union-aware for-in
// fix (which covered the VALUE variable and the single loop variable) to the
// two-variable form's KEY/index variable.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const uri = `/tmp/ffk-${n++}.uc`;
  await server.getDiagnostics(code, uri); // settle full analysis before hovering
  const h = await server.getHover(code, uri, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}

// ── Preserved behavior: plain object / plain array (worked before this fix) ──
test('01 for (k, v in object) → k is string', async () => {
  const code = 'let o = { a: 1 }; for (let k, v in o) { let x = k; }\n';
  expect(await typeOf(code, 'x = k')).toContain('string');
});
test('02 for (i, v in array) → i is integer', async () => {
  const code = 'let arr = ["a", "b"]; for (let i, v in arr) { let x = i; }\n';
  expect(await typeOf(code, 'x = i')).toContain('integer');
});

// ── The core fix: union iterables (object|null, array<T>|null) ───────────────
test('03 for (k, v in object|null) → k is still string, not unknown', async () => {
  const code = 'function f(flag){ let o = flag ? { a: 1 } : null; for (let k, v in o) { let x = k; } }\n';
  const t = await typeOf(code, 'x = k');
  expect(t).toContain('string');
  expect(t).not.toMatch(/\bunknown\b/);
});
test('04 for (i, v in array<T>|null) → i is still integer, not unknown', async () => {
  const code = 'function f(flag){ let a = flag ? ["x"] : null; for (let i, v in a) { let x = i; } }\n';
  const t = await typeOf(code, 'x = i');
  expect(t).toContain('integer');
  expect(t).not.toMatch(/\bunknown\b/);
});

// ── object | array union → key is string | integer ────────────────────────────
test('05 for (k, v in object|array) → k is string | integer', async () => {
  const code = 'function f(flag){ let x = flag ? { a: 1 } : ["a"]; for (let k, v in x) { let y = k; } }\n';
  const t = await typeOf(code, 'y = k');
  expect(t).toContain('string');
  expect(t).toContain('integer');
});

// ── The `unknown` row: body only runs if the iterable was object or array ────
test('06 for (k, v in <unknown>) → k is string | integer (never bare unknown)', async () => {
  const code = 'function f(thing){ for (let k, v in thing) { let x = k; } }\n';
  const t = await typeOf(code, 'x = k');
  expect(t).toContain('string');
  expect(t).toContain('integer');
});

// ── Asymmetry vs the value var is intentional and must stay ───────────────────
test('07 the VALUE var of a two-var for-in over `unknown` is still bare unknown', async () => {
  const code = 'function f(thing){ for (let k, v in thing) { let x = v; } }\n';
  expect(await typeOf(code, 'x = v')).toContain('unknown');
});
test('08 the VALUE var over object|null stays unknown (object values are not strings)', async () => {
  const code = 'function f(flag){ let o = flag ? { a: 1 } : null; for (let k, v in o) { let x = v; } }\n';
  expect(await typeOf(code, 'x = v')).not.toMatch(/string/);
});

// ── Single-variable form is untouched by this fix: verify its existing shape ──
test('09 single-var for (k in object) binds the KEY (string)', async () => {
  const code = 'let o = { a: 1 }; for (let k in o) { let x = k; }\n';
  expect(await typeOf(code, 'x = k')).toContain('string');
});
test('10 single-var for (v in array) binds the VALUE (element type), not an index', async () => {
  const code = 'let arr = ["a", "b"]; for (let v in arr) { let x = v; }\n';
  expect(await typeOf(code, 'x = v')).toContain('string');
});
