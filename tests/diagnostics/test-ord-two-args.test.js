// ord(str[, offset]) takes TWO parameters (docs/ord-two-args-and-libc-signature-audit.md):
// lib.c uc_ord reads an optional int64 offset (negative = from the END, like substr;
// out of range → null; a double truncates; a non-numeric offset yields null).
// We registered it with ONE parameter, so hover/signature help showed a single arg
// and a 3-arg call was silently accepted. Every behavior here is oracle-verified
// against BOTH /usr/local/bin/ucode and ./ucode/build/ucode (identical output).

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

const file = (n) => `/tmp/test-ord-two-args-${n}.uc`;

test('one-arg and two-arg ord() calls are clean', async () => {
  const code =
    'let subject = "abc";\n' +
    'let first = ord(subject);\n' +
    'let second = ord(subject, 1);\n' +
    'let fromEnd = ord(subject, -1);\n' +
    'print(first, second, fromEnd);\n';
  const diags = await server.getDiagnostics(code, file('clean'));
  expect(diags.filter(d => d.severity === 1 || d.severity === 2)).toEqual([]);
});

test('three-arg ord() is a WARNING, not an error (the runtime ignores extras)', async () => {
  const code = 'print(ord("abc", 1, 2));\n';
  //           0123456789012345678901  — the extra `2` spans chars 20-21
  const diags = await server.getDiagnostics(code, file('threearg'));
  const arity = diags.filter(d => d.code === 'UC2003');
  expect(arity.length).toBe(1);
  expect(arity[0].severity).toBe(2); // warning — the call still runs (oracle: prints 98)
  expect(arity[0].message).toContain('expects at most 2 arguments, got 3 (extra arguments are ignored)');
  // anchored on the extra argument, not the whole call
  expect(arity[0].range.start.character).toBe(20);
  expect(arity[0].range.end.character).toBe(21);
});

test('provably out-of-range offset: warning + definite null', async () => {
  const code =
    'let outRange = ord("abc", 9);\n' +
    'let negOut = ord("abc", -4);\n' +
    'print(outRange, negOut);\n';
  const diags = await server.getDiagnostics(code, file('oob'));
  const oob = diags.filter(d => d.message.includes('always returns null'));
  expect(oob.length).toBe(2);
  expect(oob[0].message).toContain('offset 9 is out of range for "abc" (3 bytes)');
  // anchored on the offset argument: `9` at line 0 chars 26-27
  expect(oob[0].range.start.line).toBe(0);
  expect(oob[0].range.start.character).toBe(26);
  expect(oob[1].message).toContain('offset -4 is out of range');
  // and the result is a definite null now, not integer | null
  const h = await server.getHover(code, file('oob-hover'), 0, 6);
  const text = JSON.stringify(h?.contents);
  expect(text).toContain('`null`');
  expect(text).not.toContain('integer');
});

test('ord("") is always null: warning anchored on the empty string', async () => {
  const code = 'let noByte = ord("");\nprint(noByte);\n';
  const diags = await server.getDiagnostics(code, file('empty'));
  const oob = diags.filter(d => d.message.includes('always returns null'));
  expect(oob.length).toBe(1);
  expect(oob[0].message).toContain('the string is empty');
});

test('a non-ASCII subject stays integer | null (byte length unprovable from JS)', async () => {
  const code = 'let accented = ord("\\u00e9", 1);\nprint(accented);\n';
  const diags = await server.getDiagnostics(code, file('nonascii'));
  expect(diags.filter(d => d.message.includes('always returns null'))).toEqual([]);
  const h = await server.getHover(code, file('nonascii-hover'), 0, 6);
  expect(JSON.stringify(h?.contents)).toContain('integer | null');
});

test('a double offset is accepted (lib.c truncates it)', async () => {
  // oracle: ord("abc", 1.5) → 98 on both binaries
  const code = 'print(ord("abc", 1.5));\n';
  const diags = await server.getDiagnostics(code, file('double'));
  expect(diags.filter(d => d.severity === 1)).toEqual([]);
});

test('a string offset is flagged (yields null at runtime)', async () => {
  const code = 'print(ord("abc", "1"));\n';
  const diags = await server.getDiagnostics(code, file('stroff'));
  expect(diags.length).toBeGreaterThanOrEqual(1);
  expect(diags.some(d => d.message.includes('ord'))).toBe(true);
});

// ── return-type soundness: provable in-bounds reads are definite integers ──────

test('hover: literal string + literal in-bounds offset is a definite integer', async () => {
  const code =
    'let inBounds = ord("abc", 1);\n' +
    'let fromEndOk = ord("abc", -3);\n' +
    'print(inBounds, fromEndOk);\n';
  const h1 = await server.getHover(code, file('hover-in'), 0, 6);
  expect(JSON.stringify(h1?.contents)).toContain('`integer`');
  const h2 = await server.getHover(code, file('hover-in2'), 1, 6);
  expect(JSON.stringify(h2?.contents)).toContain('`integer`');
});

test('hover: a never-reassigned variable propagates its literal (constant folding)', async () => {
  // `subject` provably holds "abc" for its whole lifetime, so ord(subject) and
  // ord(subject, constOffset) are in bounds — definite integer, no null.
  const code =
    'let subject = "abc";\n' +
    'let constOffset = 1;\n' +
    'let folded = ord(subject);\n' +
    'let foldedAt = ord(subject, constOffset);\n' +
    'print(folded, foldedAt);\n';
  for (const [line, name] of [[2, 'folded'], [3, 'foldedAt']]) {
    const h = await server.getHover(code, file(`hover-const-${name}`), line, 5);
    const text = JSON.stringify(h?.contents);
    expect(text).toContain('`integer`');
    expect(text).not.toContain('null');
  }
});

test('hover: an unprovable subject stays integer | null', async () => {
  // `mutable` is reassigned on a conditional path, so its value is NOT constant —
  // no bounds proof either way. (Provably OUT-of-range cases are definite null
  // now — covered in the out-of-range test above.)
  const code =
    'let mutable = "abc";\n' +
    'if (length(ARGV) > 0)\n' +
    '    mutable = "";\n' +
    'let dynamic = ord(mutable, 1);\n' +
    'print(dynamic);\n';
  const h = await server.getHover(code, file('hover-null-dynamic'), 3, 6);
  expect(JSON.stringify(h?.contents)).toContain('integer | null');
});

// ── hover doc + signature help carry the second parameter ─────────────────────

test('hover on ord itself documents the optional offset parameter', async () => {
  const code = 'print(ord("abc", 1));\n';
  const h = await server.getHover(code, file('doc'), 0, 7);
  const text = JSON.stringify(h?.contents ?? '');
  expect(text).toContain('offset');
  expect(text).toContain('egative');   // negative-from-end semantics documented
});

test('signature help lists both parameters', async () => {
  const code = 'print(ord("abc", 1));\n';
  const sig = await server.getSignatureHelp(code, file('sig'), 0, 17);
  const s = JSON.stringify(sig ?? '');
  expect(s).toContain('offset');
});
