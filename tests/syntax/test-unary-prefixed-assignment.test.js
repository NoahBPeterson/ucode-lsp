// unary-prefixed-assignment-target-uc6001: a prefix unary operator applied to an
// assignment (`!lvalue = rhs`) was rejected with two hard UC6001 errors ("Invalid
// assignment target" + "Unexpected token in expression"), which then cascaded and
// poisoned the rest of the line. It is valid ucode: assignment binds *below* a prefix
// unary operator, so `!k[2] = f()` runs as `!(k[2] = f())`. Corpus hit:
//   openwrt/.../hostapd.uc:407  `if(!k[2] = hostapd.rkh_derive_key(k[2]))`
// Verified against ucode (-R) — scope matches the interpreter exactly:
//   accepts:  !a = b   !a += b   -a = b   ~a = b   !k[2] = f()
//   rejects:  ++a = b (invalid inc/dec operand)   !(a+1) = b   !a() = 5  (non-lvalue)
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/unary-assign-${n++}.uc`;
const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const has6001 = async (code) => (await errs(code)).some((m) => /Invalid assignment target|Unexpected token in expression/.test(m));

// ── must accept (ucode runs these) ───────────────────────────────────────────
test('! on a plain identifier assignment: !a = b', async () => {
  expect(await has6001('let a, b = 5;\n!a = b;\n')).toBe(false);
});
test('! on a member assignment: !k[2] = f()', async () => {
  expect(await has6001('let k = [1, 2, 3];\nfunction f(x) { return x; }\n!k[2] = f(k[2]);\n')).toBe(false);
});
test('the real corpus idiom inside an if: if (!k[2] = f(k[2]))', async () => {
  const code = 'let k = [1, 2, 3];\nfunction f(x) { return x; }\nif (!k[2] = f(k[2]))\n\treturn;\n';
  expect(await has6001(code)).toBe(false);
});
test('compound assignment under !: !a += b', async () => {
  expect(await has6001('let a = 1, b = 5;\n!a += b;\n')).toBe(false);
});
test('arithmetic prefix unary: -a = b and ~a = b', async () => {
  expect(await has6001('let a = 1, b = 5;\n-a = b;\n')).toBe(false);
  expect(await has6001('let a = 1, b = 5;\n~a = b;\n')).toBe(false);
});
test('nullish compound under !: !a ??= b', async () => {
  expect(await has6001('let a, b = 5;\n!a ??= b;\n')).toBe(false);
});

// ── must reject (ucode rejects these — guard against a false negative) ────────
test('prefix ++ does NOT absorb assignment: ++a = b stays rejected', async () => {
  expect(await has6001('let a = 1, b = 5;\n++a = b;\n')).toBe(true);
});
test('non-lvalue parenthesized operand stays rejected: !(a + 1) = b', async () => {
  expect(await has6001('let a = 1, b = 5;\n!(a + 1) = b;\n')).toBe(true);
});
test('call-result operand stays rejected: !a() = 5', async () => {
  expect(await has6001('function a() { return 1; }\n!a() = 5;\n')).toBe(true);
});

// ── UC6007 clarity warning + paren quick fix ─────────────────────────────────
const warns = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 2).map((x) => x.message);
// Apply a set of LSP TextEdits (handles multi-edit fixes; applies right-to-left).
function applyEdits(code, file, edits) {
  const lines = code.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = code;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}
async function fixFor(code, titleRe) {
  const file = uri();
  const diags = (await server.getDiagnostics(code, file)) || [];
  const d = diags.find((x) => x.code === 'UC6007');
  if (!d) return { diag: null, edits: null };
  const acts = (await server.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  const a = acts.find((x) => titleRe.test(x.title));
  return { diag: d, edits: a && a.edit.changes[`file://${file}`] };
}

test('UC6007 warns on !x = y (and ONLY a warning, not an error)', async () => {
  const ms = await warns('let a, b = 5;\n!a = b;\n');
  expect(ms.some((m) => /assignment binds below/.test(m))).toBe(true);
});
test('UC6007 fires even under \'use strict\'', async () => {
  const ms = await warns("'use strict';\nlet a, b = 5;\n!a = b;\n");
  expect(ms.some((m) => /assignment binds below/.test(m))).toBe(true);
});
test('no UC6007 on a plain unary without assignment', async () => {
  expect((await warns('let a = 1;\nif (!a) print("x");\nlet c = -a;\n'))
    .some((m) => /assignment binds below/.test(m))).toBe(false);
});
test('paren quick fix turns !a = b into !(a = b)', async () => {
  const code = 'let a, b = 5;\n!a = b;\n';
  const { edits } = await fixFor(code, /parentheses/);
  expect(edits).toBeTruthy();
  expect(applyEdits(code, undefined, edits)).toContain('!(a = b);');
});
test('paren quick fix on member target: !k[2] = f(k[2]) → !(k[2] = f(k[2]))', async () => {
  const code = 'let k = [1, 2, 3];\nfunction f(x) { return x; }\n!k[2] = f(k[2]);\n';
  const { edits } = await fixFor(code, /parentheses/);
  expect(applyEdits(code, undefined, edits)).toContain('!(k[2] = f(k[2]));');
});
test('already-parenthesized !(x = y) does NOT warn (so the quick fix resolves the diagnostic)', async () => {
  expect((await warns('let a, b = 5;\n!(a = b);\n'))
    .some((m) => /assignment binds below/.test(m))).toBe(false);
});
test('applying the quick fix produces code that no longer warns', async () => {
  const code = 'let a, b = 5;\n!a = b;\n';
  const { edits } = await fixFor(code, /parentheses/);
  const fixed = applyEdits(code, undefined, edits);
  expect((await warns(fixed)).some((m) => /assignment binds below/.test(m))).toBe(false);
});
