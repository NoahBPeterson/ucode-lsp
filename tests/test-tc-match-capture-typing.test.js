// Static capture-group typing for match() against a REGEX LITERAL (docs/
// tc-match-capture-group-typing.md). Ground truth: `uc_match` (ucode/lib.c:3126)
// returns, on success, EXACTLY `1 + re_nsub` elements — participating groups as
// strings, non-participating groups as `NULL` (rm_so == -1). ucode compiles the
// pattern straight through `regcomp(..., REG_EXTENDED)` (ucode/types.c:1397-1415,
// no preprocessing) — verified against the runtime that `(?:...)` is a regcomp
// error ("repetition-operator operand invalid"), so every unescaped `(` outside a
// bracket expression is a real capturing group; there is no non-capturing form.
//
// A capture group is OPTIONAL (may be null even on a successful overall match)
// iff, on the path from the pattern root to that group: it's directly under a
// 0-minimum quantifier (`?`, `*`, `{0,...}`), OR its enclosing frame (the whole
// pattern, or an ancestor group's own body) has a top-level `|` (the group is one
// alternation branch and the other might run instead), OR an ancestor group is
// itself optional. Alternation INSIDE a group's own body does NOT make that group
// optional (`(stdout|stderr|exitcode)` is one mandatory group).
//
// This is implemented as a minimal tuple-shaped ArrayType (symbolTable.ts
// ArrayType.tupleTypes / resolveTupleIndex) — NOT a general tuple-type system —
// that a LITERAL index (checkMemberExpression in typeChecker.ts) resolves
// through instead of the general `element | null` union.
//
// Driven through the real LSP server (handleHover / getDiagnostics), matching
// the convention in test-tc-operator-typing.test.js / test-tc-any-display.test.js.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function hoverAt(code, needle) {
  const idx = code.lastIndexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle}`);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const uri = `/tmp/tc-match-capture-${n++}.uc`;
  await server.getDiagnostics(code, uri); // settle full analysis before hovering
  const h = await server.getHover(code, uri, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}
function exactType(hoverText) {
  const m = hoverText.match(/`([^`]+)`/);
  return m ? m[1].trim() : hoverText.trim();
}
async function typeOf(code, needle) {
  return exactType(await hoverAt(code, needle));
}
async function diagnostics(code) {
  const uri = `/tmp/tc-match-capture-${n++}.uc`;
  return (await server.getDiagnostics(code, uri)) || [];
}

describe('match() capture-group static typing (regex literal)', () => {
  test('01 mandatory group (no quantifier, no alternation) types as bare string', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /^-- File (.*)--$/)) != null) {',
      '  let g1 = m[1];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string');
  });

  test('02 mandatory group loses the nullable-argument FP on trim()', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /^-- File (.*)--$/)) != null) {',
      '  let x = trim(m[1]);',
      '}',
    ].join('\n');
    const ds = await diagnostics(code);
    expect(ds.some((d) => /nullable-argument/i.test(d.code || '') || /may be null/i.test(d.message))).toBe(false);
  });

  test('03 optional group (?) types as string | null', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /^-- End( \\(no-eol\\))? --$/)) != null) {',
      '  let g1 = m[1];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string | null');
  });

  test('04 alternation INSIDE the group is still a mandatory group', async () => {
    const code = [
      'let m;',
      "if ((m = match(line, /^(stdout|stderr|exitcode): (.*)$/)) != null) {",
      '  let g1 = m[1];',
      '  let g2 = m[2];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string');
    expect(await typeOf(code, 'g2 =')).toBe('string');
  });

  test('05 alternation OUTSIDE (a)|(b): both groups optional', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /(a)|(b)/)) != null) {',
      '  let g1 = m[1];',
      '  let g2 = m[2];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string | null');
    expect(await typeOf(code, 'g2 =')).toBe('string | null');
  });

  test('06 nested groups: outer mandatory, inner optional', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /(a(b)?c)/)) != null) {',
      '  let outer = m[1];',
      '  let inner = m[2];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'outer =')).toBe('string');
    expect(await typeOf(code, 'inner =')).toBe('string | null');
  });

  test('07 sequential groups: only the quantified one is optional', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /(a)(b)?(c)/)) != null) {',
      '  let g1 = m[1];',
      '  let g2 = m[2];',
      '  let g3 = m[3];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string');
    expect(await typeOf(code, 'g2 =')).toBe('string | null');
    expect(await typeOf(code, 'g3 =')).toBe('string');
  });

  test('08 m[0] (the full match) is always bare string', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /(a)(b)?/)) != null) {',
      '  let full = m[0];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'full =')).toBe('string');
  });

  test('09 literal out-of-range index is provably null and flags UC5008', async () => {
    const code = [
      'let m = match("x", /(a)(b)/);',
      'let oob = m[5];',
    ].join('\n');
    expect(await typeOf(code, 'oob =')).toBe('null');
    const ds = await diagnostics(code);
    const hit = ds.find((d) => d.code === 'UC5008');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe(2); // warning
    expect(hit.message).toMatch(/3 elements/);
    expect(hit.message).toMatch(/index 5/);
  });

  test('10 g flag: array<tuple> | null — indexing an element still resolves per-group', async () => {
    const code = [
      'let ms = match(line, /(a)(b)?/g);',
      'if (ms != null) {',
      '  let first = ms[0];',
      '  if (first != null) {',
      '    let g1 = first[1];',
      '    let g2 = first[2];',
      '  }',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string');
    expect(await typeOf(code, 'g2 =')).toBe('string | null');
  });

  test('11 dynamic (non-literal) regex keeps the old un-narrowed shape', async () => {
    const code = [
      'let re = regexp("(a)(b)");',
      'let m = match("x", re);',
      'let g1 = m[1];',
    ].join('\n');
    // Unchanged behavior: no static group info available, so every index is
    // just the general element type (string | null), never a hard `null`.
    expect(await typeOf(code, 'g1 =')).toBe('string | null');
  });

  test('12 a variable holding a regex literal keeps the old shape (only inline literals are analyzed)', async () => {
    const code = [
      'let re = /(a)(b)/;',
      'let m = match("x", re);',
      'let g1 = m[1];',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string | null');
  });

  test('13 lib_missing()-style mandatory `(.+)` group stops implying null in a template', async () => {
    const code = [
      'let m = match("12_lib_foo", /^([0-9][0-9])_lib_(.+)$/);',
      'if (m == null) return;',
      'let path = `${m[2]}.so`;',
    ].join('\n');
    const ds = await diagnostics(code);
    expect(ds.some((d) => /may be null/i.test(d.message) && /m\[2\]/.test(d.message))).toBe(false);
  });

  test('14 quantified group with {0,n} is optional, {1,n} stays mandatory', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /(a){0,3}(b){1,3}/)) != null) {',
      '  let g1 = m[1];',
      '  let g2 = m[2];',
      '}',
    ].join('\n');
    expect(await typeOf(code, 'g1 =')).toBe('string | null');
    expect(await typeOf(code, 'g2 =')).toBe('string');
  });
});
