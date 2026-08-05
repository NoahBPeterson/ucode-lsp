// Corner cases for loop back-edge read-before-write typing
// (docs/uc2009-loop-read-before-write-null.md; companion to
// test-loop-read-before-write.test.js). Contract under test:
//   - a UC2009 "can never be" claim on a value that a write LATER in a shared
//     loop can rescue (scalar/unknown type growth via the back edge) must DROP;
//   - claims that no back edge can rescue (straight-line, sibling loops,
//     shadowed symbols, reference-only or same-type growth) must SURVIVE;
//   - the union is never a promotion (iteration 1 keeps the declared value).
// Sections: loop positions / container shapes (lambdas, exports, anonymous
// objects) / write forms / survivors / operators / nesting / members / closures.

const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(90000);

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => server?.shutdown());

let fileNo = 0;
const uc2009 = (diags) => diags.filter(d => d.code === 'UC2009');
async function claims(code) {
  const diags = await server.getDiagnostics(code, `/tmp/test-loop-rbw-corner-${fileNo++}.uc`);
  return uc2009(diags);
}

// ── 1. read positions within the loop statement ───────────────────────────────

test('read in the for-loop TEST clause sees body writes (back edge feeds the test)', async () => {
  const found = await claims(
    'let cursor;\n' +
    'for (let round = 0; cursor != 9; round++) {\n' +
    '    cursor = 9;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read in the for-loop UPDATE clause sees body writes', async () => {
  const found = await claims(
    'let step;\n' +
    'for (let round = 0; round < 3; round += step != 2 ? 1 : 2) {\n' +
    '    step = 2;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read in the while TEST sees body writes', async () => {
  const found = await claims(
    'let token;\n' +
    'while (token != 5) {\n' +
    '    token = 5;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('for-in over an object: body read-before-write clears', async () => {
  const found = await claims(
    'let last;\n' +
    'for (let key in { a: 1, b: 2 }) {\n' +
    '    if (last != 1)\n' +
    '        print(key);\n' +
    '    last = 1;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read deep inside a chained else-if before the write clears (full LuCI ladder)', async () => {
  const found = await claims(
    'let mode;\n' +
    'for (let round = 0; round < 4; round++) {\n' +
    '    if (round == 0) {\n' +
    '        print("first\\n");\n' +
    '    } else if (mode != 7 && round > 1) {\n' +
    '        print("mid\\n");\n' +
    '    } else {\n' +
    '        mode = 7;\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

// ── 2. container shapes: lambdas, exports, anonymous objects ──────────────────

test('the loop lives in an EXPORTED function', async () => {
  const found = await claims(
    'export function scan(items) {\n' +
    '    let quote;\n' +
    '    for (let idx = 0; idx < length(items); idx++) {\n' +
    '        if (quote != 39)\n' +
    '            print(idx);\n' +
    '        quote = 39 + idx;\n' +
    '    }\n' +
    '};\n');
  expect(found).toEqual([]);
});

test('the loop lives in a lambda assigned to a let', async () => {
  const found = await claims(
    'let walk = (items) => {\n' +
    '    let seen;\n' +
    '    for (let idx = 0; idx < length(items); idx++) {\n' +
    '        if (seen != 1)\n' +
    '            print(idx);\n' +
    '        seen = 1;\n' +
    '    }\n' +
    '};\n' +
    'walk([1, 2]);\n');
  expect(found).toEqual([]);
});

test('the loop lives in a NESTED lambda (two levels down)', async () => {
  const found = await claims(
    'let outer = () => {\n' +
    '    let inner = () => {\n' +
    '        let flag;\n' +
    '        for (let round = 0; round < 2; round++) {\n' +
    '            if (flag != 3)\n' +
    '                print("go\\n");\n' +
    '            flag = 3;\n' +
    '        }\n' +
    '    };\n' +
    '    inner();\n' +
    '};\n' +
    'outer();\n');
  expect(found).toEqual([]);
});

test('read inside a lambda DEFINED in the loop body, write later in the body', async () => {
  // The lambda's body sits inside the loop extent, so its read shares the loop
  // with the write below it.
  const found = await claims(
    'let level;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    let probe = () => level != 4 ? "open" : "shut";\n' +
    '    print(probe(), "\\n");\n' +
    '    level = 4;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read inside a lambda in an UNNAMED object passed to a call, in-loop', async () => {
  const found = await claims(
    'function dispatch(handlers) {\n' +
    '    return handlers.check();\n' +
    '}\n' +
    'let gate;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    dispatch({\n' +
    '        check: function() {\n' +
    '            return gate != 2;\n' +
    '        }\n' +
    '    });\n' +
    '    gate = 2;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read inside a lambda in an ARRAY literal argument, in-loop', async () => {
  const found = await claims(
    'function firstOf(fns) {\n' +
    '    return fns[0]();\n' +
    '}\n' +
    'let phase;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    firstOf([ () => phase != 6 ]);\n' +
    '    phase = 6;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('the whole shape inside a function expression called immediately after', async () => {
  const found = await claims(
    'let boot = function() {\n' +
    '    let stage;\n' +
    '    for (let round = 0; round < 2; round++) {\n' +
    '        if (stage != 8)\n' +
    '            print("stage\\n");\n' +
    '        stage = 8;\n' +
    '    }\n' +
    '};\n' +
    'boot();\n');
  expect(found).toEqual([]);
});

// ── 3. write forms ────────────────────────────────────────────────────────────

test('multiple writes of DIFFERENT scalar types all union in', async () => {
  const found = await claims(
    'let mixed;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (mixed != 1)\n' +
    '        print("m\\n");\n' +
    '    if (round == 0)\n' +
    '        mixed = 1;\n' +
    '    else\n' +
    '        mixed = "one";\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a write via ternary RHS clears', async () => {
  const found = await claims(
    'let pick;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (pick != 2)\n' +
    '        print("p\\n");\n' +
    '    pick = round > 1 ? 2 : 3;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a write inside a switch case in the loop clears', async () => {
  const found = await claims(
    'let lane;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (lane != 4)\n' +
    '        print("l\\n");\n' +
    '    switch (round) {\n' +
    '    case 1:\n' +
    '        lane = 4;\n' +
    '        break;\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a write inside a try block in the loop clears', async () => {
  const found = await claims(
    'let risky;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (risky != 5)\n' +
    '        print("r\\n");\n' +
    '    try {\n' +
    '        risky = 5;\n' +
    '    } catch (err) {\n' +
    '        print(err);\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a write inside a catch handler in the loop clears', async () => {
  const found = await claims(
    'let caught;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (caught != 6)\n' +
    '        print("c\\n");\n' +
    '    try {\n' +
    '        die("boom");\n' +
    '    } catch (err) {\n' +
    '        caught = 6;\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a conditional (if-guarded) write still unions via the back edge', async () => {
  const found = await claims(
    'let rare;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (rare != 7)\n' +
    '        print("open\\n");\n' +
    '    if (round == 2)\n' +
    '        rare = 7;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read in the IF branch, write in the ELSE branch: the back edge crosses branches', async () => {
  const found = await claims(
    'let cross;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (round % 2) {\n' +
    '        if (cross != 9)\n' +
    '            print("odd\\n");\n' +
    '    } else {\n' +
    '        cross = 9;\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a write via a function-call value (unknown type) clears', async () => {
  const found = await claims(
    'function pull() {\n' +
    '    return length(ARGV) > 0 ? 1 : "x";\n' +
    '}\n' +
    'let fetched;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (fetched != 1)\n' +
    '        print("f\\n");\n' +
    '    fetched = pull();\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a compound assignment (+=) later in the loop clears', async () => {
  // null += coerces: on iteration 2 the value is numeric, so != 0 is not constant.
  const found = await claims(
    'let total;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (total != 0)\n' +
    '        print("t\\n");\n' +
    '    total += round;\n' +
    '}\n');
  expect(found).toEqual([]);
});

// ── 4. true positives that MUST survive ───────────────────────────────────────

test('SURVIVES: loop writes only null — no type growth, still always true', async () => {
  const found = await claims(
    'let stuckNull;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (stuckNull != 39)\n' +
    '        print("still\\n");\n' +
    '    stuckNull = null;\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('SURVIVES: loop writes only a reference (array) — references never equal a scalar', async () => {
  const found = await claims(
    'let refOnly;\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (refOnly != 39)\n' +
    '        print("ref\\n");\n' +
    '    refOnly = [ round ];\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('SURVIVES: the read sits BEFORE the loop statement entirely', async () => {
  const found = await claims(
    'let early;\n' +
    'if (early != 3)\n' +
    '    print("really null here\\n");\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    early = 3;\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('SURVIVES: the loop writes a SHADOWING inner variable, not this one', async () => {
  const found = await claims(
    'let outerName;\n' +
    'function reuse() {\n' +
    '    let outerName = 1;\n' +
    '    for (let round = 0; round < 2; round++) {\n' +
    '        outerName = round;\n' +
    '    }\n' +
    '    return outerName;\n' +
    '}\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (outerName != 5)\n' +
    '        print(reuse());\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('SURVIVES: same-named locals in two different functions do not cross', async () => {
  const found = await claims(
    'function alpha() {\n' +
    '    let marker;\n' +
    '    for (let round = 0; round < 2; round++) {\n' +
    '        if (marker != 2)\n' +
    '            print("a\\n");\n' +
    '    }\n' +
    '}\n' +
    'function beta() {\n' +
    '    let marker;\n' +
    '    for (let round = 0; round < 2; round++) {\n' +
    '        marker = 2;\n' +
    '    }\n' +
    '    return marker;\n' +
    '}\n' +
    'alpha();\n' +
    'beta();\n');
  expect(found.length).toBe(1);
});

test('SURVIVES: the write sits in a NAMED function that is never called', async () => {
  // Named declarations carry the fnSym/usedAt gate: nothing references setter
  // before (or inside) the loop, so its write provably has not run — the
  // declared-null claim is a true positive and must stay.
  const found = await claims(
    'let dormant;\n' +
    'function setter() {\n' +
    '    dormant = 1;\n' +
    '}\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (dormant != 1)\n' +
    '        print("never set\\n");\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('a write in an uncalled let-bound ARROW is conservative: no claim (documented FN)', async () => {
  // Let-bound lambdas do not get a function body frame, so their writes union
  // into the variable's type unconditionally — the lint stays silent even
  // though the arrow never runs. A false negative by design (the gate exists
  // only for named declarations); pinned so a future change is deliberate.
  const found = await claims(
    'let dormant2;\n' +
    'let unusedSetter = () => {\n' +
    '    dormant2 = 1;\n' +
    '};\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (dormant2 != 1)\n' +
    '        print("never set\\n");\n' +
    '}\n' +
    'print(type(unusedSetter));\n');
  expect(found).toEqual([]);
});

test('SURVIVES: while(true) loop writing only null', async () => {
  const found = await claims(
    'let spin;\n' +
    'while (true) {\n' +
    '    if (spin != 1)\n' +
    '        break;\n' +
    '    spin = null;\n' +
    '}\n');
  expect(found.length).toBe(1);
});

// ── 5. operator variants ──────────────────────────────────────────────────────

test('`==` (always-false claim) drops the same way', async () => {
  const found = await claims(
    'let eq;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (eq == 39)\n' +
    '        print("hit\\n");\n' +
    '    eq = 39;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('`===` strict variant drops', async () => {
  const found = await claims(
    'let seq;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (seq === 39)\n' +
    '        print("hit\\n");\n' +
    '    seq = 39;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('`!==` strict variant drops', async () => {
  const found = await claims(
    'let sneq;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (sneq !== 39)\n' +
    '        print("miss\\n");\n' +
    '    sneq = 39;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('literal on the LEFT drops the same way', async () => {
  const found = await claims(
    'let flipped;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (39 != flipped)\n' +
    '        print("f\\n");\n' +
    '    flipped = 39;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('a STRING literal comparison drops when a string write joins', async () => {
  const found = await claims(
    'let word;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (word != "done")\n' +
    '        print("w\\n");\n' +
    '    word = "done";\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('variable-vs-variable: null side loop-written drops the claim', async () => {
  const found = await claims(
    'let target = 39;\n' +
    'let probe;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (probe != target)\n' +
    '        print("p\\n");\n' +
    '    probe = 39;\n' +
    '}\n' +
    'print(target);\n');
  expect(found).toEqual([]);
});

// ── 6. nesting ────────────────────────────────────────────────────────────────

test('three-level nesting: read at depth 3, write at depth 1', async () => {
  const found = await claims(
    'let deep;\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    for (let b = 0; b < 2; b++) {\n' +
    '        for (let c = 0; c < 2; c++) {\n' +
    '            if (deep != 1)\n' +
    '                print("d\\n");\n' +
    '        }\n' +
    '    }\n' +
    '    deep = 1;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('read in one inner loop, write in a SIBLING inner loop of the same outer', async () => {
  const found = await claims(
    'let across;\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    for (let b = 0; b < 2; b++) {\n' +
    '        if (across != 2)\n' +
    '            print("x\\n");\n' +
    '    }\n' +
    '    for (let c = 0; c < 2; c++) {\n' +
    '        across = 2;\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('while nested in for: read in while test, write later in the for body', async () => {
  const found = await claims(
    'let fuel;\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    while (fuel != 3) {\n' +
    '        break;\n' +
    '    }\n' +
    '    fuel = 3;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('SURVIVES: two top-level sibling loops in the same function, read first', async () => {
  const found = await claims(
    'function twoLoops() {\n' +
    '    let gap;\n' +
    '    for (let a = 0; a < 2; a++) {\n' +
    '        if (gap != 4)\n' +
    '            print("g\\n");\n' +
    '    }\n' +
    '    for (let b = 0; b < 2; b++) {\n' +
    '        gap = 4;\n' +
    '    }\n' +
    '}\n' +
    'twoLoops();\n');
  expect(found.length).toBe(1);
});

// ── 7. member twin ────────────────────────────────────────────────────────────

test('member: nested loops, inner read, outer write', async () => {
  const found = await claims(
    'let box = { level: null };\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    for (let b = 0; b < 2; b++) {\n' +
    '        if (box.level != 5)\n' +
    '            print("b\\n");\n' +
    '    }\n' +
    '    box.level = 5;\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('member SURVIVES: the loop writes a DIFFERENT property', async () => {
  const found = await claims(
    'let pair = { left: null, right: null };\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (pair.left != 6)\n' +
    '        print("l\\n");\n' +
    '    pair.right = 6;\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('member SURVIVES: straight-line read-before-write, no loop', async () => {
  const found = await claims(
    'let cfg = { mode: null };\n' +
    'if (cfg.mode != 7)\n' +
    '    print("plain\\n");\n' +
    'cfg.mode = 7;\n' +
    'print(cfg.mode);\n');
  expect(found.length).toBe(1);
});

test('member SURVIVES: write in a LATER sibling loop', async () => {
  const found = await claims(
    'let slot = { value: null };\n' +
    'for (let a = 0; a < 2; a++) {\n' +
    '    if (slot.value != 8)\n' +
    '        print("s\\n");\n' +
    '}\n' +
    'for (let b = 0; b < 2; b++) {\n' +
    '    slot.value = 8;\n' +
    '}\n');
  expect(found.length).toBe(1);
});

test('member: write in the ELSE branch, read in the IF branch, same loop', async () => {
  const found = await claims(
    'let sw = { lane: null };\n' +
    'for (let round = 0; round < 3; round++) {\n' +
    '    if (round % 2) {\n' +
    '        if (sw.lane != 9)\n' +
    '            print("odd\\n");\n' +
    '    } else {\n' +
    '        sw.lane = 9;\n' +
    '    }\n' +
    '}\n');
  expect(found).toEqual([]);
});

// ── 8. closures called within the loop ────────────────────────────────────────

test('write inside a lambda CALLED later in the same loop clears the earlier read', async () => {
  const found = await claims(
    'let relayed;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (relayed != 1)\n' +
    '        print("pre\\n");\n' +
    '    let setIt = () => {\n' +
    '        relayed = 1;\n' +
    '    };\n' +
    '    setIt();\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('write inside a NESTED lambda called through an outer lambda in the loop', async () => {
  const found = await claims(
    'let doubled;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (doubled != 2)\n' +
    '        print("pre\\n");\n' +
    '    let outerFn = () => {\n' +
    '        let innerFn = () => {\n' +
    '            doubled = 2;\n' +
    '        };\n' +
    '        innerFn();\n' +
    '    };\n' +
    '    outerFn();\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('write inside a lambda handed to an unnamed object whose method the loop calls', async () => {
  const found = await claims(
    'function invoke(bundle) {\n' +
    '    return bundle.apply();\n' +
    '}\n' +
    'let bundled;\n' +
    'for (let round = 0; round < 2; round++) {\n' +
    '    if (bundled != 3)\n' +
    '        print("pre\\n");\n' +
    '    invoke({\n' +
    '        apply: function() {\n' +
    '            bundled = 3;\n' +
    '        }\n' +
    '    });\n' +
    '}\n');
  expect(found).toEqual([]);
});

test('bare for-in head as the comparison variable: element-typed, no claim', async () => {
  const found = await claims(
    'let cursor2;\n' +
    'for (cursor2 in [3, 4]) {\n' +
    '    if (cursor2 != 3)\n' +
    '        print("second\\n");\n' +
    '}\n');
  expect(found).toEqual([]);
});
