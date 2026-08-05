// Loop read-before-write (docs/uc2009-loop-read-before-write-null.md): a read
// that sits textually BEFORE a write in the SAME loop body still sees that
// write's type on iteration 2+ — the back edge delivers it. The positional walk
// (effectiveSymbolType) used to skip "future" writes entirely and fall back to
// the declared type, so `let quote` read at the top of a loop that assigns
// `quote = q` further down typed as definite `null` — and the UC2009 comparison
// lint claimed `null can never be != 39` on real LuCI code (jow's shell-quoting
// parse_args). Hover already applied the loop-carried join; both consumers must
// agree. Back-edge writes are UNION-only: they are never definite for an
// earlier read (iteration 1 really does see the declared value).

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

const file = (n) => `/tmp/test-loop-rbw-${n}.uc`;
const uc2009 = (diags) => diags.filter(d => d.code === 'UC2009');

test('the LuCI unquote shape: no UC2009 on the read-before-write comparison', async () => {
  const code =
    'function isquote(byteVal) {\n' +
    '    return byteVal == 34 || byteVal == 39 ? byteVal : 0;\n' +
    '}\n' +
    'function unquote(str, start, stop) {\n' +
    '    let esc, quote, res = [];\n' +
    '    for (let off = start; off < stop; off++) {\n' +
    '        const byte = ord(str, off);\n' +
    '        const quoteByte = isquote(byte);\n' +
    '        if (esc) {\n' +
    '            esc = false;\n' +
    '        }\n' +
    '        else if (byte == 92 && quote != 39) {\n' +   // the FP site
    '            esc = true;\n' +
    '        }\n' +
    '        else if (quoteByte && quote && quoteByte == quote) {\n' +
    '            quote = null;\n' +
    '        }\n' +
    '        else if (quoteByte && !quote) {\n' +
    '            quote = quoteByte;\n' +
    '        }\n' +
    '        else {\n' +
    '            push(res, byte);\n' +
    '        }\n' +
    '    }\n' +
    '    return res;\n' +
    '}\n' +
    'print(unquote("ab", 0, 2), "\\n");\n';
  const diags = await server.getDiagnostics(code, file('luci'));
  expect(uc2009(diags)).toEqual([]);
});

test('hover at the read-before-write site is the loop-carried union', async () => {
  const code =
    'let carrier;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (carrier != 39)\n' +
    '        print("open\\n");\n' +
    '    carrier = 7;\n' +
    '}\n';
  const h = await server.getHover(code, file('hover'), 2, 9);
  const text = JSON.stringify(h?.contents);
  expect(text).toContain('integer | null');
});

test('while and for-in loops carry the back edge too', async () => {
  const code =
    'let seenW;\n' +
    'let ticks = 0;\n' +
    'while (ticks < 3) {\n' +
    '    if (seenW != 1)\n' +
    '        ticks++;\n' +
    '    seenW = 1;\n' +
    '}\n' +
    'let seenF;\n' +
    'for (let entry in [1, 2]) {\n' +
    '    if (seenF != 5)\n' +
    '        print(entry);\n' +
    '    seenF = 5;\n' +
    '}\n';
  const diags = await server.getDiagnostics(code, file('while-forin'));
  expect(uc2009(diags)).toEqual([]);
});

test('back-edge writes are union-only: iteration 1 still sees the declared null', async () => {
  // Hovering the READ of `lagging` (post-analysis, full history): the later
  // write must UNION in via the back edge, never PROMOTE — iteration 1 really
  // sees the declared null, so the answer is `integer | null`, not `integer`
  // and not bare `null`. (A binding initialized FROM the read — `let snapshot
  // = lagging;` — still stamps its own type mid-pass from partial history;
  // that single-pass limit is why the UC2009 filter re-validates post-hoc.)
  const code =
    'let lagging;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    let snapshot = lagging;\n' +
    '    print(snapshot);\n' +
    '    lagging = 42;\n' +
    '}\n';
  const h = await server.getHover(code, file('union-only'), 2, 20); // `lagging` read
  const text = JSON.stringify(h?.contents);
  expect(text).toContain('integer | null');
});

test('a NON-loop read before a later write stays declared-null (real true positive)', async () => {
  const code =
    'let pending;\n' +
    'if (pending != 39)\n' +
    '    print("always\\n");\n' +
    'pending = 39;\n' +
    'print(pending);\n';
  const diags = await server.getDiagnostics(code, file('straightline'));
  expect(uc2009(diags).length).toBe(1);
  expect(uc2009(diags)[0].message).toContain('null');
});

test('a write in a DIFFERENT (earlier or later) loop does not reach this loop', async () => {
  const code =
    'let stray;\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    if (stray != 8)\n' +
    '        print("first\\n");\n' +
    '}\n' +
    'for (let b = 0; b < 2; b++) {\n' +
    '    stray = 8;\n' +
    '}\n';
  // The read-loop contains no write; the write-loop comes AFTER every read.
  // The declared-null read really can never be 8 there — the lint must stay.
  const diags = await server.getDiagnostics(code, file('sibling-loops'));
  expect(uc2009(diags).length).toBe(1);
});

test('nested loops: an inner-loop write reaches an outer-loop read before it', async () => {
  const code =
    'let inner;\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    if (inner != 3)\n' +
    '        print("pre\\n");\n' +
    '    for (let b = 0; b < 2; b++) {\n' +
    '        inner = 3;\n' +
    '    }\n' +
    '}\n';
  const diags = await server.getDiagnostics(code, file('nested'));
  expect(uc2009(diags)).toEqual([]);
});

test('member twin: obj.prop read-before-write in a loop is not declared-baseline', async () => {
  const code =
    'let state = { mode: null };\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (state.mode != 39)\n' +
    '        print("open\\n");\n' +
    '    state.mode = 39;\n' +
    '}\n';
  const diags = await server.getDiagnostics(code, file('member'));
  expect(uc2009(diags)).toEqual([]);
});
