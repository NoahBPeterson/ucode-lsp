// Negative array indices (docs/tc-negative-array-index.md). Ground truth:
// `ucv_key_get` (ucode/types.c:2435-2440) converts a negative index with
// `|idx| <= length` via `idx += ucv_array_length(scope)` before the bounds
// check — `a[-1]` is the last element, first-class semantics.
//
// Two independent gaps fixed here:
//  1. Hover on the number token of a NEGATIVE literal (`a[-1]`) dropped the sign
//     (src/hover.ts scalar-literal branch is token-based; the unary `-` is a
//     separate token from the digits). Fixed by checking whether the immediately
//     preceding token is a GENUINELY unary `-` (previous-previous token is an
//     operator/`(`/`[`/`,`/`=`/keyword/statement-start — NOT an identifier,
//     literal, `)`, `]`, `}` etc., which would make it binary subtraction).
//  2. Element typing: a negative literal index into `array<T>` must resolve to
//     `T` (with the same null-uncertainty as a positive index absent a bounds
//     proof — parity, not a stronger guarantee) instead of silently degrading.
//     The literal-index fast paths (`arr[N] = x` write-tracking and its
//     matching read) used a strict `property.type === 'Literal'` check, which a
//     negative index (parsed as `UnaryExpression(-, Literal)`) never satisfies —
//     extended via the shared `arrayIndexKeyOf` helper (typeChecker.ts).
//
// Driven through the real LSP server (handleHover / getDiagnostics), matching
// the convention in test-tc-operator-typing.test.js.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// Hover at an explicit (line, character) — needed for the negative-literal
// cases, since the sign and the digits are two different tokens and we need
// precise control over which one the cursor lands on.
async function hoverExact(code, line, character) {
  const uri = `/tmp/tc-negidx-${n++}.uc`;
  await server.getDiagnostics(code, uri);
  const h = await server.getHover(code, uri, line, character);
  return h;
}
function hoverText(h) {
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}
async function hoverAt(code, needle) {
  const idx = code.lastIndexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle}`);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await hoverExact(code, line, col);
  return hoverText(h);
}
function exactType(text) {
  const m = text.match(/`([^`]+)`/);
  return m ? m[1].trim() : text.trim();
}
async function typeOf(code, needle) {
  return exactType(await hoverAt(code, needle));
}

describe('Negative array index — hover', () => {
  test('01 hovering the digit of a[-1] renders the sign', async () => {
    const code = 'let a = [1, 2, 3];\nprint(a[-1]);\n';
    const line = 1;
    const digitCol = code.split('\n')[1].indexOf('-1') + 1; // on the '1'
    const h = hoverText(await hoverExact(code, line, digitCol));
    expect(h).toBe('(literal) `-1`: `integer`');
  });

  test('02 hovering the minus itself shows the same negative-literal hover', async () => {
    const code = 'let a = [1, 2, 3];\nprint(a[-1]);\n';
    const line = 1;
    const minusCol = code.split('\n')[1].indexOf('-1'); // on the '-'
    const h = hoverText(await hoverExact(code, line, minusCol));
    expect(h).toBe('(literal) `-1`: `integer`');
  });

  test('03 hover range covers both the minus and the digit', async () => {
    const code = 'let a = [1, 2, 3];\nprint(a[-1]);\n';
    const line = 1;
    const lineText = code.split('\n')[1];
    const digitCol = lineText.indexOf('-1') + 1;
    const h = await hoverExact(code, line, digitCol);
    expect(h.range.start.character).toBe(lineText.indexOf('-1'));
    expect(h.range.end.character).toBe(lineText.indexOf('-1') + 2);
  });

  test('04 binary subtraction `x - 1` does NOT render a sign on the 1', async () => {
    const code = 'let x = 5;\nlet sub = x - 1;\n';
    const lineText = code.split('\n')[1];
    const oneCol = lineText.lastIndexOf('1');
    const h = hoverText(await hoverExact(code, 1, oneCol));
    expect(h).toBe('(literal) `1`: `integer`');
  });

  test('05 the decimal-value note negates for an exotic negative literal (-0x1F = -31)', async () => {
    const code = 'print(-0x1F);\n';
    const lineText = code.split('\n')[0];
    const col = lineText.indexOf('1F');
    const h = hoverText(await hoverExact(code, 0, col));
    expect(h).toBe('(literal) `-0x1F` = -31: `integer`');
  });

  test('06 a genuinely-unary minus at the very start of an expression list', async () => {
    const code = 'let arr = [-1, -2, -3];\n';
    const lineText = code;
    const col = lineText.indexOf('-2') + 1;
    const h = hoverText(await hoverExact(code, 0, col));
    expect(h).toBe('(literal) `-2`: `integer`');
  });
});

describe('Negative array index — element typing', () => {
  test('07 a[-1] on array<integer> resolves to integer (with the same null-uncertainty as a[0])', async () => {
    const code = 'let a = [1, 2, 3];\nlet last = a[-1];\nlet first = a[0];\n';
    const lastType = await typeOf(code, 'last =');
    const firstType = await typeOf(code, 'first =');
    // Parity: neither index is statically proven in-bounds here, so both carry
    // the same `| null` uncertainty — the point is the element type (`integer`)
    // is preserved, not silently degraded to `unknown`.
    expect(lastType).toBe(firstType);
    expect(lastType).toContain('integer');
  });

  test('08 negative literal index into a string-typed array', async () => {
    const code = 'let a = ["x", "y", "z"];\nlet last = a[-1];\n';
    expect(await typeOf(code, 'last =')).toContain('string');
  });

  test('09 negative index resolves through match() capture-group tuples too (m[-1] = last group)', async () => {
    const code = [
      'let m;',
      'if ((m = match(line, /(a)(b)/)) != null) {',
      '  let lastGroup = m[-1];',
      '}',
    ].join('\n');
    // m has 3 slots (full match + 2 groups); index -1 -> slot 2 (mandatory 'b' group).
    expect(await typeOf(code, 'lastGroup =')).toBe('string');
  });

  test('10 negative literal write/read round-trip through the per-index tracking', async () => {
    // The per-index propertyTypes write-tracking lives in checkAssignmentExpression,
    // which is only reached via checkNode when the assignment is a SUB-expression
    // (see computeAssignmentResultType's doc comment) — a bare top-level
    // `arr[i] = x;` statement never dispatches through it (a pre-existing
    // limitation shared equally by positive indices, not something this fix
    // changes). Exercise it the way the mechanism is actually reachable: the
    // assignment as a call argument.
    const code = [
      'let a = [];',
      'print(a[-1] = "hello");',
      'let v = a[-1];',
    ].join('\n');
    expect(await typeOf(code, 'v =')).toBe('string');
  });

  test('11 no spurious diagnostic on a negative literal index by itself', async () => {
    const code = 'let a = [1, 2, 3];\nlet last = a[-1];\n';
    const uri = `/tmp/tc-negidx-${n++}.uc`;
    const ds = (await server.getDiagnostics(code, uri)) || [];
    expect(ds.some((d) => /negative/i.test(d.message))).toBe(false);
  });
});
