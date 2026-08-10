// Top-level flow refinement (0.8.7) — two FPs found auditing wwand-migrate:
//
// 1. UC8002 treated a `let` inside a top-level loop/if BLOCK as a global: the
//    localNames scan only read the program's immediate statement list, so the
//    conditional reassignment registered as a "global def below" and the read
//    above it flagged (wwand `for (…) { let cur = …; if (…) cur = [cur]; }`).
// 2. The conditional-normalize idiom at top level —
//        let cur = cursor.get(…) ?? [];
//        if (type(cur) != 'array') cur = (cur != null) ? [cur] : [];
//        push(cur, v);
//    kept flagging push(): the join of "guard proved array" and "reassigned to
//    array" IS array, but only a flow engine computes joins and none existed
//    for top-level code. A program-level engine now feeds a REFINE-ONLY
//    post-visit filter for argument diagnostics (it can drop a provably-clean
//    complaint, never add or change anything else — hover and the other
//    filters deliberately do not see it).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function diags(codeLines) {
  const code = codeLines.join('\n');
  return (await server.getDiagnostics(code, `/tmp/tlflow-${n++}.uc`)) || [];
}
const codes = (ds, c) => ds.filter((d) => String(d.code) === c);

test('wwand-migrate shape: loop-scoped let + conditional normalize is clean', async () => {
  const ds = await diags([
    "'use strict';",
    'let changes = [["add_list", "network", "s", "o", "v"]];',
    'for (let c in changes) {',
    "\tif (c[0] == 'add_list') {",
    '\t\tlet cur = ARGV[0] ?? [];',
    "\t\tif (type(cur) != 'array')",
    '\t\t\tcur = (cur != null) ? [ cur ] : [];',
    '\t\tpush(cur, c[4]);',
    '\t}',
    '}']);
  expect(codes(ds, 'UC8002')).toEqual([]);
  expect(codes(ds, 'nullable-argument')).toEqual([]);
});

test('UC8002 does not fire on a let inside a top-level if block', async () => {
  const ds = await diags([
    "'use strict';",
    'if (length(ARGV) > 0) {',
    '\tlet p = ARGV[0];',
    "\tif (p == null) p = '';",
    '\tprint(p);',
    '}']);
  expect(codes(ds, 'UC8002')).toEqual([]);
});

test('UC8002 does not fire on a catch parameter normalized in its handler', async () => {
  // `e` is block-scoped to the handler; its normalize is not a "global def".
  const ds = await diags([
    "'use strict';",
    'try {',
    '\tprint(json(ARGV[0] ?? ""));',
    '} catch (e) {',
    "\tif (!e) e = 'unknown';",
    '\tprint(e);',
    '}']);
  expect(codes(ds, 'UC8002')).toEqual([]);
});

test('UC8002 treats a bare for-in head as a write, not a read', async () => {
  // `for (k in …)` ASSIGNS k each iteration — neither the head nor the body
  // read is "before" the later real assignment in the order sense.
  const ds = await diags([
    'for (k in [1, 2])',
    '\tprint(k);',
    'k = 5;',
    'print(k);']);
  expect(codes(ds, 'UC8002')).toEqual([]);
});

test('UC8002 still fires on a REAL global read before its assignment', async () => {
  const ds = await diags([
    "'use strict';",
    'print(counter);',
    'counter = 1;']);
  expect(codes(ds, 'UC8002').length).toBe(1);
});

test('the rpc-cgi shape: null-arm normalize proves string at the use', async () => {
  const ds = await diags([
    "'use strict';",
    'let cookie = getenv("HTTP_COOKIE");',
    'if (cookie == null)',
    "\tcookie = '';",
    'print(match(cookie, /Admin-Token=([^;]+)/));']);
  expect(codes(ds, 'nullable-argument')).toEqual([]);
});

test('an UNGUARDED nullable argument still fires (control)', async () => {
  const ds = await diags([
    "'use strict';",
    'let cookie = getenv("HTTP_COOKIE");',
    'print(match(cookie, /Admin-Token=([^;]+)/));']);
  expect(codes(ds, 'nullable-argument').length).toBe(1);
});

test('a PARTIAL normalize (reassign on a sub-condition) keeps the diagnostic', async () => {
  // The reassignment does not cover every non-array path — the join still
  // carries the bad member, so the refine-only filter must keep the complaint.
  const ds = await diags([
    "'use strict';",
    'let cur = ARGV[0] ?? [];',
    "if (type(cur) != 'array' && length(ARGV) > 9)",
    '\tcur = [ cur ];',
    'push(cur, "x");']);
  expect(codes(ds, 'nullable-argument').length).toBe(1);
});

test('normalize inside a FUNCTION still works (per-function engine path)', async () => {
  const ds = await diags([
    "'use strict';",
    'function add_item(v) {',
    '\tlet cur = ARGV[0] ?? [];',
    "\tif (type(cur) != 'array')",
    '\t\tcur = (cur != null) ? [ cur ] : [];',
    '\tpush(cur, v);',
    '\treturn cur;',
    '}',
    'print(add_item(1));']);
  expect(codes(ds, 'nullable-argument')).toEqual([]);
});

test('try-block write does not over-narrow: the exception path keeps the union', async () => {
  // The CFG models the try-entry → catch edge, so after the try the engine
  // joins the unwritten state back in — the may-null complaint must survive.
  const ds = await diags([
    "'use strict';",
    'let data = null;',
    'try {',
    '\tdata = b64dec(ARGV[0] ?? "");',
    '} catch (e) {',
    '\twarn(`${e}\\n`);',
    '}',
    'print(match(data, /x/));']);
  expect(codes(ds, 'nullable-argument').length).toBe(1);
});
