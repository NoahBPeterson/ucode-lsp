// Within-iteration dominance (soundness+precision follow-up to the 0.7.92 loop
// contract): an in-loop write REPLACES (is definite) for a read when — and only
// when — every path of every iteration reaching the read passed the write first:
//   read inside the write's INNERMOST loop  ∧  write textually before the read
//   ∧  read inside the write's innermost branch frame (or write unbranched)
//   ∧  no closure boundary inside the loop between them.
// (symbolTable writeDominatesIteration; frames come from if/switch/ternary/
// short-circuit/try visitors; closure boundaries from the fnBodyExtents
// registry, which keeps growing so lambdas defined AFTER the write count.)
// Anything that breaks one leg of the proof must stay a union.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(120000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

// Hover the FIRST occurrence of `needle`, cursor `plus` chars in.
async function hov(code, needle, plus = 0) {
  const i = code.indexOf(needle) + plus;
  const pre = code.slice(0, i);
  const h = await server.getHover(code, `/tmp/test-dom-${n++}.uc`, pre.split('\n').length - 1, i - pre.lastIndexOf('\n') - 1);
  const v = h?.contents?.value ?? '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
async function diags(code) {
  return server.getDiagnostics(code, `/tmp/test-dom-${n++}.uc`);
}
const definite = (text, ty) => { expect(text).toContain('`' + ty + '`'); };
const union = (text, ...parts) => { for (const p of parts) expect(text).toContain(p); };

// ════ A. dominance HOLDS — definite type, no union ═══════════════════════════

test('A1: straight-line write→read in a for body is definite', async () => {
  const t = await hov('let av;\nfor (let i = 0; i < 2; i++) {\n    av = 5;\n    print(av);\n}\n', 'print(av', 6);
  definite(t, 'integer');
});

test('A2: while body write→read is definite', async () => {
  const t = await hov('let aw;\nlet going = true;\nwhile (going) {\n    aw = "on";\n    print(aw);\n    going = false;\n}\n', 'print(aw', 6);
  definite(t, 'string');
});

test('A3: for-in body write→read is definite', async () => {
  const t = await hov('let ax;\nfor (let k in [1, 2]) {\n    ax = k;\n    print(ax);\n}\n', 'print(ax', 6);
  definite(t, 'integer');
});

test('A4: the read can be any later statement in the body', async () => {
  const t = await hov('let ay;\nfor (let i = 0; i < 2; i++) {\n    ay = 3;\n    let doubled = ay + ay;\n    print(doubled);\n}\n', 'ay + ay', 0);
  definite(t, 'integer');
});

test('A5: write in an if-branch dominates a read in the SAME branch', async () => {
  const t = await hov('let az;\nfor (let i = 0; i < 3; i++) {\n    if (i % 2) {\n        az = "odd";\n        print(az);\n    }\n}\n', 'print(az', 6);
  definite(t, 'string');
});

test('A6: write and read in the same doubly-nested if-branch', async () => {
  const t = await hov('let ba;\nfor (let i = 0; i < 3; i++) {\n    if (i) {\n        if (i > 1) {\n            ba = 9;\n            print(ba);\n        }\n    }\n}\n', 'print(ba', 6);
  definite(t, 'integer');
});

test('A7: an outer-body write dominates reads inside a LATER inner loop', async () => {
  const t = await hov('let bb;\nfor (let a = 0; a < 2; a++) {\n    bb = "set";\n    for (let b = 0; b < 2; b++) {\n        print(bb);\n    }\n}\n', 'print(bb', 6);
  definite(t, 'string');
});

test('A8: write→read inside the innermost of two nested loops', async () => {
  const t = await hov('let bc;\nfor (let a = 0; a < 2; a++) {\n    for (let b = 0; b < 2; b++) {\n        bc = 1;\n        print(bc);\n    }\n}\n', 'print(bc', 6);
  definite(t, 'integer');
});

test('A9: member write→read in the same loop body is definite', async () => {
  const t = await hov('let box = { v: null };\nfor (let i = 0; i < 2; i++) {\n    box.v = i;\n    print(box.v);\n}\n', 'print(box.v', 10);
  definite(t, 'integer');
});

test('A10: member write in an if-branch dominates a read in the same branch', async () => {
  const t = await hov('let bag = { s: null };\nfor (let i = 0; i < 2; i++) {\n    if (i) {\n        bag.s = "in";\n        print(bag.s);\n    }\n}\n', 'print(bag.s', 10);
  definite(t, 'string');
});

test('A11: the LAST dominating write before the read wins', async () => {
  const t = await hov('let bd;\nfor (let i = 0; i < 2; i++) {\n    bd = 1;\n    bd = "two";\n    print(bd);\n}\n', 'print(bd', 6);
  definite(t, 'string');
  expect(t).not.toContain('integer');
});

test('A12: dominated write + later back-edge write = union of the two (never the seed)', async () => {
  // print(be2) sees the dominated 5 this iteration; the back edge cannot rescue
  // "s" past the re-write, but the walk keeps it (sound imprecision). What it
  // must NOT contain is the declared null — the dominating write killed it.
  const t = await hov('let be2;\nfor (let i = 0; i < 2; i++) {\n    be2 = 5;\n    print(be2);\n    be2 = "s";\n}\n', 'print(be2', 6);
  union(t, 'integer', 'string');
  expect(t).not.toContain('null');
});

test('A13: write in a switch case dominates a read later in the SAME case', async () => {
  const t = await hov('let bf;\nfor (let i = 0; i < 3; i++) {\n    switch (i) {\n    case 1:\n        bf = "one";\n        print(bf);\n        break;\n    }\n}\n', 'print(bf', 6);
  definite(t, 'string');
});

test('A14: write in a try block dominates a read later in the same block', async () => {
  const t = await hov('let bg;\nfor (let i = 0; i < 2; i++) {\n    try {\n        bg = 4;\n        print(bg);\n    } catch (e) {\n        print(e);\n    }\n}\n', 'print(bg', 6);
  definite(t, 'integer');
});

test('A15: a write nested in a call argument still dominates the next statement', async () => {
  const t = await hov('let bh;\nlet sink = [];\nfor (let i = 0; i < 2; i++) {\n    push(sink, bh = 7);\n    print(bh);\n}\n', 'print(bh', 6);
  definite(t, 'integer');
});

test('A16: dominated string arg produces NO builtin-arg diagnostic', async () => {
  const d = await diags('let bi;\nfor (let i = 0; i < 2; i++) {\n    bi = "text  ";\n    print(rtrim(bi));\n}\n');
  expect(d.filter(x => x.severity === 1 || x.severity === 2)).toEqual([]);
});

test('A17: dominated member string arg is clean too', async () => {
  const d = await diags('let msg = { text: null };\nfor (let i = 0; i < 2; i++) {\n    msg.text = "hi ";\n    print(rtrim(msg.text));\n}\n');
  expect(d.filter(x => x.severity === 1 || x.severity === 2)).toEqual([]);
});

test('A18: dominated object write clears member access (no UC5005)', async () => {
  const d = await diags('let holder;\nfor (let i = 0; i < 2; i++) {\n    holder = { port: 22 };\n    print(holder.port);\n}\n');
  expect(d.filter(x => x.code === 'UC5005')).toEqual([]);
});

test('A19: a derived binding from a dominated read is definite', async () => {
  const t = await hov('let bj;\nfor (let i = 0; i < 2; i++) {\n    bj = 6;\n    let copyOf = bj;\n    print(copyOf);\n}\n', 'copyOf = bj', 0);
  definite(t, 'integer');
  expect(t).not.toContain('null');
});

test('A20: dominance holds inside an exported function', async () => {
  const t = await hov('export function work() {\n    let bk;\n    for (let i = 0; i < 2; i++) {\n        bk = "w";\n        print(bk);\n    }\n};\n', 'print(bk', 6);
  definite(t, 'string');
});

test('A21: dominated definite null makes the UC2009 claim a TRUE positive', async () => {
  // Every iteration re-nulls right before the read — "always true" is correct.
  const d = await diags('let bl;\nfor (let i = 0; i < 2; i++) {\n    bl = null;\n    if (bl != 39)\n        print("t");\n}\n');
  expect(d.filter(x => x.code === 'UC2009').length).toBe(1);
});

test('A22: dominated null arg keeps the definite arg error (re-check confirms it)', async () => {
  const d = await diags('let bm;\nfor (let i = 0; i < 2; i++) {\n    bm = null;\n    print(rtrim(bm));\n}\n');
  expect(d.filter(x => x.code === 'UC2004').length).toBe(1);
});

test('A23: while(true) body write→read is definite', async () => {
  const t = await hov('let bn;\nwhile (true) {\n    bn = 2;\n    print(bn);\n    break;\n}\n', 'print(bn', 6);
  definite(t, 'integer');
});

test('A24: dominance survives an intervening UNRELATED closure (boundary contains neither)', async () => {
  // The lambda sits between write and read textually but contains NEITHER of
  // them — reading other state must not break the write→read proof.
  const t = await hov('let bo;\nlet other = 1;\nfor (let i = 0; i < 2; i++) {\n    bo = 8;\n    let f = () => other;\n    print(f(), bo);\n}\n', ', bo', 2);
  definite(t, 'integer');
});

test('A25: write and read BOTH inside the same in-loop closure body dominate', async () => {
  const t = await hov('let bp;\nfor (let i = 0; i < 2; i++) {\n    let inner = function() {\n        bp = "c";\n        print(bp);\n    };\n    inner();\n}\n', 'print(bp', 6);
  definite(t, 'string');
});

// ════ B. dominance BROKEN — the union survives ═══════════════════════════════

test('B1: read BEFORE the write (back edge) stays a union', async () => {
  const t = await hov('let ca;\nfor (let i = 0; i < 2; i++) {\n    print(ca);\n    ca = 5;\n}\n', 'print(ca', 6);
  union(t, 'integer', 'null');
});

test('B2: post-loop read stays a union (zero-iteration path)', async () => {
  const t = await hov('let cb;\nfor (let i = 0; i < length(ARGV); i++) {\n    cb = 5;\n}\nprint(cb);\n', 'print(cb', 6);
  union(t, 'integer', 'null');
});

test('B3: write in an if-branch, read AFTER the if in the same loop — union', async () => {
  const t = await hov('let cc;\nfor (let i = 0; i < 2; i++) {\n    if (i)\n        cc = 5;\n    print(cc);\n}\n', 'print(cc', 6);
  union(t, 'integer', 'null');
});

test('B4: write in the if-branch, read in the ELSE branch — union (cross-iteration)', async () => {
  const t = await hov('let cd;\nfor (let i = 0; i < 3; i++) {\n    if (i % 2) {\n        cd = 5;\n    } else {\n        print(cd);\n    }\n}\n', 'print(cd', 6);
  union(t, 'integer', 'null');
});

test('B5: write in a switch case, read AFTER the switch — union', async () => {
  const t = await hov('let ce;\nfor (let i = 0; i < 3; i++) {\n    switch (i) {\n    case 1:\n        ce = 5;\n        break;\n    }\n    print(ce);\n}\n', 'print(ce', 6);
  union(t, 'integer', 'null');
});

test('B6: write in a try block, read AFTER the try — union (exception path)', async () => {
  const t = await hov('let cf;\nfor (let i = 0; i < 2; i++) {\n    try {\n        cf = 5;\n    } catch (e) {\n        print(e);\n    }\n    print(cf);\n}\n', '    print(cf', 10);
  union(t, 'integer', 'null');
});

test('B7: write in a catch handler, read after — union', async () => {
  const t = await hov('let cg;\nfor (let i = 0; i < 2; i++) {\n    try {\n        die("x");\n    } catch (e) {\n        cg = 5;\n    }\n    print(cg);\n}\n', 'print(cg', 6);
  union(t, 'integer', 'null');
});

test('B8: write on a short-circuit RHS, read after — union', async () => {
  const t = await hov('let ch2;\nfor (let i = 0; i < 2; i++) {\n    i && (ch2 = 5);\n    print(ch2);\n}\n', 'print(ch2', 6);
  union(t, 'integer', 'null');
});

test('B9: write in a ternary arm, read after — union', async () => {
  const t = await hov('let ci;\nfor (let i = 0; i < 2; i++) {\n    let r = i ? (ci = 5) : 0;\n    print(r, ci);\n}\n', ', ci', 2);
  union(t, 'integer', 'null');
});

test('B10: a read inside a closure defined between two writes unions ALL values', async () => {
  const t = await hov('let cj;\nfor (let i = 0; i < 2; i++) {\n    cj = 5;\n    let peek = function() { return cj; };\n    cj = "s";\n    print(peek());\n}\n', 'return cj', 7);
  union(t, 'integer', 'string', 'null');
});

test('B11: same for an expression-bodied arrow (its body extent registers too)', async () => {
  const t = await hov('let ck;\nfor (let i = 0; i < 2; i++) {\n    ck = 5;\n    let peek = () => ck;\n    ck = "s";\n    print(peek());\n}\n', '=> ck', 3);
  union(t, 'integer', 'string', 'null');
});

test('B12: a write inside an in-loop closure does not dominate a read outside it', async () => {
  const t = await hov('let cl;\nfor (let i = 0; i < 2; i++) {\n    let setIt = function() { cl = 7; };\n    setIt();\n    print(cl);\n}\n', 'print(cl', 6);
  union(t, 'integer', 'null');
});

test('B13: an inner SIBLING loop write does not dominate the outer read after it', async () => {
  const t = await hov('let cm;\nfor (let a = 0; a < 2; a++) {\n    for (let b = 0; b < length(ARGV); b++) {\n        cm = 5;\n    }\n    print(cm);\n}\n', 'print(cm', 6);
  union(t, 'integer', 'null');
});

test('B14: inside the inner loop, a read before the inner write stays a union', async () => {
  const t = await hov('let cn;\nfor (let a = 0; a < 2; a++) {\n    for (let b = 0; b < 2; b++) {\n        print(cn);\n        cn = 5;\n    }\n}\n', 'print(cn', 6);
  union(t, 'integer', 'null');
});

test('B15: for-loop UPDATE clause read is not dominated by a body write (documented conservative)', async () => {
  // The update runs after the body at runtime, but it sits textually before the
  // write, so the walk treats it as back-edge delivery — union, never definite.
  const t = await hov('let co;\nfor (let i = 0; i < 4; i += co != null ? 2 : 1) {\n    co = 1;\n}\n', 'co != null', 0);
  union(t, 'integer', 'null');
});

test('B16: while TEST read is not dominated by a body write — union', async () => {
  const t = await hov('let cp;\nwhile (cp != 5) {\n    cp = 5;\n}\n', 'cp != 5', 0);
  union(t, 'integer', 'null');
});

test('B17: member read before the member write (back edge) — union', async () => {
  const t = await hov('let mtr = { v: null };\nfor (let i = 0; i < 2; i++) {\n    print(mtr.v);\n    mtr.v = 5;\n}\n', 'print(mtr.v', 10);
  union(t, 'integer', 'null');
});

test('B18: member write in an if-branch, read after the if — union', async () => {
  const t = await hov('let mtq = { v: null };\nfor (let i = 0; i < 2; i++) {\n    if (i)\n        mtq.v = 5;\n    print(mtq.v);\n}\n', 'print(mtq.v', 10);
  union(t, 'integer', 'null');
});

test('B19: member write, closure read, rewrite — closure sees the union', async () => {
  const t = await hov('let mts = { v: null };\nfor (let i = 0; i < 2; i++) {\n    mts.v = 5;\n    let peek = function() { return mts.v; };\n    mts.v = "s";\n    print(peek());\n}\n', 'return mts.v', 11);
  union(t, 'integer', 'string');
});

test('B20: member write inside an in-loop closure does not dominate outside', async () => {
  const t = await hov('let mtt = { v: null };\nfor (let i = 0; i < 2; i++) {\n    let setIt = function() { mtt.v = 7; };\n    setIt();\n    print(mtt.v);\n}\n', 'print(mtt.v', 10);
  union(t, 'integer', 'null');
});

test('B21: `||=` with a truthy pre-loop value keeps the union (short-circuit frame)', async () => {
  const t = await hov('let cq = "keep";\nfor (let i = 0; i < 2; i++) {\n    cq ||= { a: 1 };\n    print(cq);\n}\n', 'print(cq', 6);
  union(t, 'string', 'object');
});

test('B22: dominance never crosses OUT of the loop — a pre-loop read is untouched', async () => {
  const t = await hov('let cr;\nprint(cr);\nfor (let i = 0; i < 2; i++) {\n    cr = 5;\n}\n', 'print(cr', 6);
  definite(t, 'null');
  expect(t).not.toContain('integer');
});

test('B23: read-before-write arg diagnostic is the may-be warning, never silent, never error', async () => {
  const d = await diags('let cs;\nfor (let i = 0; i < 2; i++) {\n    print(rtrim(cs));\n    cs = "x";\n}\n');
  const hits = d.filter(x => String(x.code) === 'nullable-argument');
  expect(hits.length).toBe(1);
  expect(hits[0].severity).toBe(2);
});

test('B24: two same-branch writes of different types, read in that branch — last dominates', async () => {
  const t = await hov('let ct;\nfor (let i = 0; i < 2; i++) {\n    if (i) {\n        ct = 1;\n        ct = "s";\n        print(ct);\n    }\n}\n', 'print(ct', 6);
  definite(t, 'string');
  expect(t).not.toContain('integer');
});

test('B25: a FUNCTION DECLARATION inside the loop is a closure boundary too', async () => {
  const t = await hov('for (let i = 0; i < 2; i++) {\n    let cu = 5;\n    function peekFn() { return cu; }\n    cu = "s";\n    print(peekFn());\n}\nlet cu;\n', 'return cu', 7);
  union(t, 'integer', 'string');
});
