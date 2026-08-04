// Constant-folding edge cases for ord()/chr() (docs/ord-two-args-and-libc-signature-audit.md).
// The resolver folds string/integer literals, never-rebound variables initialized
// from them, and ord()/chr() calls over such constants — ASCII-exact only, since
// for pure ASCII the JS length/char codes equal ucode's byte semantics.
// Oracle-verified on BOTH /usr/local/bin/ucode and ./ucode/build/ucode:
//   chr is variadic (chr(72,73)=="HI"), never null, clamps to 0..255
//   (chr(-5)==chr(0), chr(300)==chr(255)), coerces non-numerics to 0;
//   "\U5C71" is NOT an escape — it is the 5 ASCII bytes "U5C71" (lexer.c only
//   knows \u with exactly 4 hex digits); chr(ord("a")) == "a" (single-byte
//   reflexivity); chr(ord("山")) != "山" (ord reads ONE byte, 229).

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

const file = (n) => `/tmp/test-ord-chr-fold-${n}.uc`;

async function hoverText(code, name, line, character) {
  const h = await server.getHover(code, file(name), line, character);
  return JSON.stringify(h?.contents ?? '');
}
const expectDefiniteInteger = (text) => { expect(text).toContain('`integer`'); expect(text).not.toContain('null'); };
const expectMaybeNull = (text) => { expect(text).toContain('integer | null'); };

// ── what folds ────────────────────────────────────────────────────────────────

test('const declarations and chained let aliases fold', async () => {
  const code =
    'const fixed = "abc";\n' +
    'let alias = fixed;\n' +
    'let viaConst = ord(fixed, 2);\n' +
    'let viaChain = ord(alias);\n' +
    'print(viaConst, viaChain);\n';
  expectDefiniteInteger(await hoverText(code, 'const', 2, 5));
  expectDefiniteInteger(await hoverText(code, 'chain', 3, 5));
});

test('a unary-minus constant offset folds (negative = from the end)', async () => {
  const code =
    'let negOff = -1;\n' +
    'let lastByte = ord("abc", negOff);\n' +
    'print(lastByte);\n';
  expectDefiniteInteger(await hoverText(code, 'negoff', 1, 5));
});

test('ord over chr folds: ord(chr(97)) is a definite integer', async () => {
  const code = 'let roundTrip = ord(chr(97));\nprint(roundTrip);\n';
  expectDefiniteInteger(await hoverText(code, 'chr-subject', 0, 5));
});

test('reflexivity chain folds through variables: ord(chr(ord(letter)))', async () => {
  const code =
    'let letter = "a";\n' +
    'let echo = chr(ord(letter));\n' +
    'let deep = ord(echo);\n' +
    'print(deep);\n';
  expectDefiniteInteger(await hoverText(code, 'reflex', 2, 5));
});

test("'\\U5C71' is literal text \"U5C71\" (not an escape) — folds and is in bounds", async () => {
  // oracle: length("\U5C71") == 5, ord("\U5C71") == 85 ('U')
  const code = "let letterU = ord('\\U5C71');\nlet fifth = ord('\\U5C71', 4);\nprint(letterU, fifth);\n";
  expectDefiniteInteger(await hoverText(code, 'bigU', 0, 5));
  expectDefiniteInteger(await hoverText(code, 'bigU-5th', 1, 5));
});

test('a real \\u escape decodes — multi-byte result stays unprovable', async () => {
  // oracle: "\u5C71" is 山 (3 UTF-8 bytes); ord("\u5C71") == 229 but byte
  // reasoning from a JS string is not exact, so no claim either way
  const code = 'let mountain = ord("\\u5C71");\nprint(mountain);\n';
  expectMaybeNull(await hoverText(code, 'mountain', 0, 5));
});

test('variadic chr folds as an ord subject, including out-of-range detection', async () => {
  const code =
    'let pair = ord(chr(72, 73), 1);\n' +
    'let pastPair = ord(chr(72, 73), 2);\n' +
    'print(pair, pastPair);\n';
  expectDefiniteInteger(await hoverText(code, 'pair', 0, 5));
  const diags = await server.getDiagnostics(code, file('pair-oob'));
  const oob = diags.filter(d => d.message.includes('always returns null'));
  expect(oob.length).toBe(1);
  expect(oob[0].message).toContain('offset 2 is out of range');
});

// ── what must NOT fold ────────────────────────────────────────────────────────

test('compound assignment breaks folding', async () => {
  const code =
    'let grown = "abc";\n' +
    'grown += "d";\n' +
    'let read = ord(grown, 3);\n' +
    'print(read);\n';
  expectMaybeNull(await hoverText(code, 'compound', 2, 5));
});

test('++ on the offset variable breaks folding', async () => {
  const code =
    'let cursor = 1;\n' +
    'cursor++;\n' +
    'let read = ord("abc", cursor);\n' +
    'print(read);\n';
  expectMaybeNull(await hoverText(code, 'incr', 2, 5));
});

test('a BARE for-in head rebinds the outer variable and breaks folding', async () => {
  const code =
    'let item = "ab";\n' +
    'for (item in ["xyz"]) {\n' +
    '}\n' +
    'let read = ord(item);\n' +
    'print(read);\n';
  expectMaybeNull(await hoverText(code, 'forin', 3, 5));
});

test('a SHADOWING for-in declaration does NOT break the outer constant', async () => {
  // `for (let item in …)` declares its own loop binding — the outer `item`
  // is untouched, so the fold must survive. (The loop head's symbol is a
  // deliberate loop-scope declaration in the table; identity, not name,
  // decides.)
  const code =
    'let item = "ab";\n' +
    'function walkShadow() {\n' +
    '    for (let item in ["xyz"]) {\n' +
    '        print(item);\n' +
    '    }\n' +
    '}\n' +
    'let read = ord(item);\n' +
    'print(read, walkShadow());\n';
  expectDefiniteInteger(await hoverText(code, 'forin-shadow', 6, 5));
});

test('a bare for-in head over a NEARER local does not break the outer constant', async () => {
  // Inside walkLocal, the bare `for (item in …)` rebinds the FUNCTION-local
  // `item` (the enclosing binding at the loop), not the top-level one — the
  // outer fold must survive.
  const code =
    'let item = "ab";\n' +
    'function walkLocal() {\n' +
    '    let item = "zz";\n' +
    '    for (item in ["xyz"]) {\n' +
    '    }\n' +
    '    return item;\n' +
    '}\n' +
    'let read = ord(item);\n' +
    'print(read, walkLocal());\n';
  expectDefiniteInteger(await hoverText(code, 'forin-local', 7, 5));
});

test('export let breaks folding (the binding escapes)', async () => {
  const code =
    'export let exposed = "abc";\n' +
    'let read = ord(exposed);\n' +
    'print(read);\n';
  expectMaybeNull(await hoverText(code, 'exported', 1, 5));
});

test('an inner shadow being reassigned does NOT break the outer constant', async () => {
  const code =
    'let stable = "abc";\n' +
    'function mutateShadow() {\n' +
    '    let stable = "zz";\n' +
    '    stable = "q";\n' +
    '    return stable;\n' +
    '}\n' +
    'let read = ord(stable, 2);\n' +
    'print(read, mutateShadow());\n';
  expectDefiniteInteger(await hoverText(code, 'shadow', 6, 5));
});

test('a user function shadowing the ord/chr builtin is not folded', async () => {
  const code =
    'function chr(value) {\n' +
    '    return "custom";\n' +
    '}\n' +
    'let notFolded = ord(chr(97), 5);\n' +
    'print(notFolded);\n';
  // With builtin chr this would be a provable out-of-range (always-null warning);
  // the shadow makes the value unknowable, so no such claim may appear.
  const diags = await server.getDiagnostics(code, file('shadowed-chr'));
  expect(diags.filter(d => d.message.includes('always returns null'))).toEqual([]);
});

test('non-integer chr arguments stop the chr fold (coercion is not modeled)', async () => {
  // chr("a") is byte 0 at runtime (coerced) — legal but flagged as a soft
  // coercion warning; the fold must NOT claim a value for it.
  const code = 'let coerced = ord(chr("a"));\nprint(coerced);\n';
  expectMaybeNull(await hoverText(code, 'coerce', 0, 5));
});

// ── chr() itself: arity + coercion severity ───────────────────────────────────

test('variadic chr() is accepted; non-numeric arg is a WARNING (runtime coerces)', async () => {
  const code =
    'let multi = chr(72, 73, 74);\n' +
    'let coerced = chr("oops");\n' +
    'print(multi, coerced);\n';
  const diags = await server.getDiagnostics(code, file('chr-arity'));
  expect(diags.filter(d => d.severity === 1)).toEqual([]); // no hard errors
  const warn = diags.filter(d => d.severity === 2 && d.message.includes('chr'));
  expect(warn.length).toBe(1); // exactly the "oops" coercion
  expect(warn[0].range.start.line).toBe(1);
});

test('chr clamps out-of-range codes without complaint (oracle: chr(300)==chr(255))', async () => {
  const code = 'let clamped = chr(-5, 300);\nprint(clamped);\n';
  const diags = await server.getDiagnostics(code, file('chr-clamp'));
  expect(diags.filter(d => d.severity === 1 || d.severity === 2)).toEqual([]);
});
