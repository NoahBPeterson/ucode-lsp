// Loop-carried flow state — crystallization suite (docs/tc-loop-carried-flow-join.md).
//
// A variable assigned inside a loop on some path and read on a LATER iteration must NOT be
// flagged "definitely null" (UC5005 error / UC2009 "always false"): the loop back-edge join
// carries the earlier-iteration value into the loop head. A genuine first-iteration null may
// still surface as a soft UC5006 may-null WARNING — that is correct, only the hard ERROR is wrong.
//
// Every pattern below is LEGAL ucode, runtime-verified against the `ucode` binary (each loop's
// read sees the value set on an earlier iteration; outputs recorded per case). These are 10
// similar-but-distinct shapes chosen to stress the fixpoint from different angles: array index,
// negative index, member access, comparison, self-referential accumulator, while-loop, for-in
// value carry, nested loops, reset-to-null, match-assignment guard, and continue-carry.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/lcf-${n++}.uc`)) || [];
const codes = (ds) => ds.map(d => d.code);
// The bug this guards against: a HARD definite-null diagnostic on a loop-carried read.
const hasHardNull = (ds) => ds.some(d => d.code === 'UC5005' || d.code === 'UC2009');

describe('loop-carried state must not produce a definite-null ERROR (UC5005/UC2009)', () => {
  // 1 — negative-index end read of a loop-carried array. runtime: prints "tail","tail".
  test('01 negative index a[-1] on a loop-carried array', async () => {
    const ds = await diags('function f() {\n  let section;\n  for (let i = 0; i < 3; i++) {\n    if (i == 0) section = ["args", "tail"];\n    else print(section[-1], "\\n");\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 2 — equality against a loop-carried string (the UC2009 "always false" trap). runtime: "code","code".
  test('02 comparison mode == "code" on loop-carried string', async () => {
    const ds = await diags('function f() {\n  let mode;\n  for (let i = 0; i < 3; i++) {\n    if (i == 0) mode = "code";\n    else if (mode == "code") print("code\\n");\n  }\n}\n');
    expect(ds.some(d => d.code === 'UC2009')).toBe(false);
    expect(hasHardNull(ds)).toBe(false);
  });

  // 3 — member access on a loop-carried object (UC5005 target). runtime: "eth0","eth0".
  test('03 member access cfg.name on a loop-carried object', async () => {
    const ds = await diags('function f() {\n  let cfg;\n  for (let i = 0; i < 3; i++) {\n    if (i == 0) cfg = { name: "eth0" };\n    else print(cfg.name, "\\n");\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 4 — self-referential accumulator across for-in. runtime: acc == 6.
  test('04 self-referential accumulator acc = acc == null ? x : acc + x', async () => {
    const ds = await diags('function f() {\n  let acc;\n  for (let x in [1, 2, 3]) { acc = (acc == null) ? x : acc + x; }\n  return acc;\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 5 — while-loop carry with index read. runtime: prints 3, 3.
  test('05 while-loop carried array, index read s[0]', async () => {
    const ds = await diags('function f() {\n  let s; let n = 3;\n  while (n > 0) {\n    if (n == 3) s = [n];\n    else print(s[0], "\\n");\n    n--;\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 6 — for-in VALUE carried forward, member read on the previous value. runtime: prints 1.
  test('06 for-in value carried to the next iteration (prev.x)', async () => {
    const ds = await diags('function f() {\n  let prev;\n  for (let k, v in { a: {x:1}, b: {x:2} }) {\n    if (prev != null) print(prev.x, "\\n");\n    prev = v;\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 7 — nested loops: outer-branch set read by inner branch. runtime: prints 0 five times.
  test('07 nested loops carrying state across both back-edges', async () => {
    const ds = await diags('function f() {\n  let found;\n  for (let i = 0; i < 2; i++)\n    for (let j = 0; j < 3; j++) {\n      if (i == 0 && j == 0) found = [i, j];\n      else if (found != null) print(found[0], "\\n");\n    }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 9 — match-assignment guard inside a loop: (m = match(...)) != null narrows m. runtime: prints captures.
  test('09 assignment-in-condition guard on a loop-local match result', async () => {
    const ds = await diags('function f() {\n  let m;\n  for (let str in ["a1", "b2"]) {\n    if ((m = match(str, /([a-z])([0-9])/)) != null)\n      print(m[1], m[2], "\\n");\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });

  // 10 — continue-carry: value set then `continue`, used on later iterations. runtime: prints 1,3,5.
  test('10 continue-carried accumulator across iterations', async () => {
    const ds = await diags('function f() {\n  let p;\n  for (let i = 0; i < 4; i++) {\n    if (i == 0) { p = i; continue; }\n    print(p + i, "\\n");\n    p = i;\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);
  });
});

describe('a genuine first-iteration null stays a soft may-null WARNING, never a hard error', () => {
  // 8 — reset-to-null at the end of the branch → the joined state is genuinely array|null, so the
  // read IS may-null (static analysis can't prove the even/odd alternation). runtime: prints 0, 2.
  // Correct behaviour: a UC5006 may-null WARNING, and NO UC5005/UC2009 hard error.
  test('08 reset-to-null then re-read → UC5006 warning, not a UC5005/UC2009 error', async () => {
    const ds = await diags('function f() {\n  let sec;\n  for (let i = 0; i < 4; i++) {\n    if (i % 2 == 0) sec = [i];\n    else { print(sec[0], "\\n"); sec = null; }\n  }\n}\n');
    expect(hasHardNull(ds)).toBe(false);              // no definite-null error
    expect(ds.some(d => d.code === 'UC5006')).toBe(true); // but a defensible may-null warning
    expect((ds.find(d => d.code === 'UC5006') || {}).severity).toBe(2); // Warning, not Error
  });
});
