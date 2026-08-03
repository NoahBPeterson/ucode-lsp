// Container reads must carry `| null` (docs/type-soundness-audit.md H-2 + H-3):
// a dict read `m[k]` yields null when the key is missing, and a cross-file
// factory that returns null on some path (or falls off the end) yields null at
// the call site. Both previously claimed a DEFINITE object, silencing the
// null-safety warnings that exist for exactly these crashes. Every crash shape
// here is oracle-verified against /usr/local/bin/ucode.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

const base = '/tmp/test-container-read-null';
const ws = path.join(base, 'ws');
const LIBS = {
  // Explicit `return null` branch — the classic guarded factory.
  'null-lib.uc':
    'export function create(c) {\n' +
    '    if (!c)\n' +
    '        return null;\n' +
    '    return { port: 22, run: function() { return 1; } };\n' +
    '};\n',
  // No else and no trailing return — falls off the end (implicit null).
  'fall-lib.uc':
    'export function mk(c) {\n' +
    '    if (c)\n' +
    '        return { port: 8080 };\n' +
    '};\n',
  // Every path returns an object — no null anywhere.
  'total-lib.uc':
    'export function make(c) {\n' +
    '    if (c)\n' +
    '        return { port: 1, kind: "a" };\n' +
    '    return { port: 2, kind: "b" };\n' +
    '};\n',
  // Same key, DIFFERENT value types per branch — the merge must union them,
  // not take branch 0 verbatim.
  'merge-lib.uc':
    'export function pick(c) {\n' +
    '    if (c)\n' +
    '        return { v: 1, both: "x" };\n' +
    '    return { v: "s", both: "y" };\n' +
    '};\n',
};

let server, n = 0;
beforeAll(async () => {
  for (const [name, content] of Object.entries(LIBS)) {
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, name), content);
  }
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => {
  try { server.shutdown(); } catch {}
  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
});

const diags = async (code) => (await server.getDiagnostics(code, path.join(ws, `t${n++}.uc`))) || [];
const hover = async (code, line, ch) => {
  const h = await server.getHover(code, path.join(ws, `t${n++}.uc`), line, ch);
  const c = h?.contents;
  return typeof c === 'string' ? c : (c?.value ?? JSON.stringify(c ?? ''));
};

describe('H-3: dict value-shape reads carry | null', () => {
  test('unguarded deref of a bound dict read WARNS (missing key is null)', async () => {
    // Runtime: "left-hand side expression is null" at e.port. Was silent.
    const ds = await diags(
      'let m = {};\n' +
      'm["a"] = { port: 1 };\n' +
      'm["b"] = { port: 2 };\n' +
      'let e = m["zzz"];\n' +
      'print(e.port, "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);   // may-null
    expect(ds.some(d => d.code === 'UC5005')).toBe(false);  // not provably-null
  });

  test('direct deref m[k].prop WARNS the same way', async () => {
    const ds = await diags(
      'let m = {};\n' +
      'm["a"] = { port: 1 };\n' +
      'm["b"] = { port: 2 };\n' +
      'print(m["zzz"].port, "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);
  });

  test('a falsy guard narrows the null away — no warning', async () => {
    const ds = await diags(
      'let m = {};\n' +
      'm["a"] = { port: 1 };\n' +
      'm["b"] = { port: 2 };\n' +
      'function get(k) {\n' +
      '    let e = m[k];\n' +
      '    if (!e)\n' +
      '        return 0;\n' +
      '    return e.port;\n' +
      '}\n' +
      'print(get("a"), "\\n");\n');
    expect(ds.filter(d => d.code === 'UC5006' || d.code === 'UC5005')).toEqual([]);
  });

  test('the value shape still rides the binding (member type resolves)', async () => {
    const text = await hover(
      'let m = {};\n' +
      'm["a"] = { port: 1 };\n' +
      'm["b"] = { port: 2 };\n' +
      'function get(k) {\n' +
      '    let e = m[k];\n' +
      '    if (!e)\n' +
      '        return 0;\n' +
      '    return e.port;\n' +
      '}\n' +
      'print(get("a"), "\\n");\n', 7, 13);
    expect(text).toContain('integer');
  });

  test('keys-of provenance proves presence: `for (k in m) m[k]` stays definite', async () => {
    // The key IS a key of the map — no missing-key null possible. (glinet
    // parental-control.uc's `for (let gid in groups) { let g = groups[gid];
    // if (!g.enabled) … }` shape: 6 corpus FPs without this exemption.)
    const ds = await diags(
      'let m = {};\n' +
      'm["a"] = { port: 1, on: true };\n' +
      'm["b"] = { port: 2, on: false };\n' +
      'for (let k in m) {\n' +
      '    let e = m[k];\n' +
      '    if (!e.on)\n' +
      '        continue;\n' +
      '    print(e.port, "\\n");\n' +
      '}\n');
    expect(ds.filter(d => d.code === 'UC5006' || d.code === 'UC5005')).toEqual([]);
  });

  test('a key of a DIFFERENT map proves nothing — still may-null', async () => {
    const ds = await diags(
      'let m = {};\n' +
      'let other = { x: 1 };\n' +
      'm["a"] = { port: 1 };\n' +
      'm["b"] = { port: 2 };\n' +
      'for (let k in other) {\n' +
      '    let e = m[k];\n' +
      '    print(e.port, "\\n");\n' +
      '}\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);
  });

  test('bucket idiom `m[k] ??= []` keeps its dominated definite array', async () => {
    const ds = await diags(
      'let m = {};\n' +
      'function add(k, v) {\n' +
      '    m[k] ??= [];\n' +
      '    push(m[k], v);\n' +
      '}\n' +
      'add("a", 1);\n');
    expect(ds.filter(d => d.severity === 1 || d.code === 'UC5006')).toEqual([]);
  });
});

describe('H-2: cross-file factory returns are honest unions', () => {
  test('null-returning factory: unguarded member deref WARNS at the importer', async () => {
    // Runtime: create(0) returns null; s.port crashes. Was silent.
    const ds = await diags(
      "import { create } from './null-lib.uc';\n" +
      'let s = create(0);\n' +
      'print(s.port, "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);
    expect(ds.some(d => d.code === 'UC5005')).toBe(false);
  });

  test('fall-through factory: implicit null joins the return union', async () => {
    const ds = await diags(
      "import { mk } from './fall-lib.uc';\n" +
      'let s = mk(0);\n' +
      'print(s.port, "\\n");\n');
    expect(ds.some(d => d.code === 'UC5006')).toBe(true);
  });

  test('factory whose every path returns an object stays definite — no noise', async () => {
    const ds = await diags(
      "import { make } from './total-lib.uc';\n" +
      'let s = make(0);\n' +
      'print(s.port, "\\n");\n');
    expect(ds.filter(d => d.code === 'UC5006' || d.code === 'UC5005')).toEqual([]);
  });

  test('guarding the factory result silences the warning', async () => {
    const ds = await diags(
      "import { create } from './null-lib.uc';\n" +
      'let s = create(0);\n' +
      'if (s)\n' +
      '    print(s.port, "\\n");\n');
    expect(ds.filter(d => d.code === 'UC5006' || d.code === 'UC5005')).toEqual([]);
  });

  test('per-branch property types UNION across returns (no branch-0 verbatim)', async () => {
    // pick(0).v is the STRING "s"; branch-0-verbatim typing claimed integer,
    // making `r.v == "s"` an "impossible" comparison. Runtime disagrees.
    const ds = await diags(
      "import { pick } from './merge-lib.uc';\n" +
      'let r = pick(1);\n' +
      'if (r.v == "s")\n' +
      '    print("str", "\\n");\n');
    expect(ds.some(d => d.code === 'UC2009')).toBe(false);
  });

  test('factory member types still resolve on the guarded path', async () => {
    const text = await hover(
      "import { create } from './null-lib.uc';\n" +
      'let s = create(0);\n' +
      'if (s)\n' +
      '    print(s.port, "\\n");\n', 3, 12);
    expect(text).toContain('integer');
  });
});
