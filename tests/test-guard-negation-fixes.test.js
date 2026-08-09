// Guard-negation & union-receiver fixes (0.8.6) — three inversions/blind spots
// found triaging the glinet gl-ucode corpus (docs/TRIAGE-2026-08-01-glinet-fp-audit.md):
//
// 1. applyTypeGuard IGNORED isNegative on combined-OR guards: the fall-through
//    of `if (t == "int" || t == "double") return …;` narrowed the variable TO
//    integer|double instead of removing them (firewall.uc is_valid_clean_port).
// 2. The member-access string check (UC5003) read the RAW union and fired
//    straight through a `type(x) == "object"` guard (cloud.uc switch_server_format).
// 3. Computed indexing of a union with MULTIPLE array members took only the
//    FIRST member's element type (`array<null> | array<string|null>` indexed as
//    bare null → cascaded into a UC2009 always-true FP, vpn-client split_host_port).
// Plus: `A || B` now applies A's NEGATED type guard inside B (`t != "string" ||
// match(v, …)` proves v is a string at the match), mirroring the else-branch flip.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function run(codeLines) {
  const code = codeLines.join('\n');
  const p = `/tmp/negfix-${n++}.uc`;
  const diags = await server.getDiagnostics(code, p);
  return { code, p, diags: diags || [] };
}
const sev1and2 = (diags) => diags.filter((d) => d.severity <= 2);

test('fall-through of an int/double early-return does NOT type the var as integer|double', async () => {
  const { diags } = await run([
    'function is_valid_clean_port(port) {',
    '\tlet t = type(port);',
    '\tif (t == "int" || t == "double") return port % 1 == 0 && port >= 1 && port <= 65535;',
    '\tif (t != "string" || match(port, /^0[0-9]+/)) return false;',
    '\treturn match(port, /^[0-9]+$/) != null;',
    '}',
    'print(is_valid_clean_port(ARGV[0]));']);
  expect(diags.filter((d) => /got integer/.test(d.message))).toEqual([]);
  // The || short-circuit also proves port is a string at both match() calls.
  expect(diags.filter((d) => /match\(\) is unknown/.test(d.message))).toEqual([]);
});

test('the else branch of a combined-OR type test still narrows POSITIVELY', async () => {
  // Inside the if, t == "int" || t == "double" holds — port arithmetic is fine.
  const { diags } = await run([
    'function f(port) {',
    '\tlet t = type(port);',
    '\tif (t == "int" || t == "double") {',
    '\t\treturn port + 1;',
    '\t}',
    '\treturn null;',
    '}',
    'print(f(ARGV[0]));']);
  expect(sev1and2(diags).filter((d) => /arithmetic|operand/i.test(d.message))).toEqual([]);
});

test('type(x) == "object" guard suppresses the string-member UC5003', async () => {
  const { diags } = await run([
    'function pick(server) {',
    '\tif (!server) return null;',
    '\tlet table = { "a": { api: "x", url: "y" } };',
    '\tfor (let k in table) {',
    '\t\tif (server == k) return table[k];',
    '\t\tif (server == "key") return k;',
    '\t}',
    '\treturn null;',
    '}',
    'let info = pick(ARGV[0]);',
    'if (type(info) == "object") {',
    '\tprint(info.url);',
    '}']);
  expect(diags.filter((d) => String(d.code) === 'UC5003')).toEqual([]);
});

test('without the guard, the string-union member access still flags (control)', async () => {
  const { diags } = await run([
    'function pick(server) {',
    '\tif (!server) return null;',
    '\tlet table = { "a": { api: "x", url: "y" } };',
    '\tfor (let k in table) {',
    '\t\tif (server == k) return table[k];',
    '\t\tif (server == "key") return k;',
    '\t}',
    '\treturn null;',
    '}',
    'let info = pick(ARGV[0]);',
    'print(info.url);']);
  expect(diags.filter((d) => String(d.code) === 'UC5003').length).toBe(1);
});

test('indexing a union of tuple-shaped arrays unions ALL element types', async () => {
  const { code, p } = await run([
    'function split_host_port(s) {',
    '\tif (type(s) != "string") return [null, null];',
    '\tlet m = match(s, /^(.*):([0-9]+)$/);',
    '\tif (m) return [m[1], m[2]];',
    '\treturn [s, null];',
    '}',
    'let hp = split_host_port(ARGV[0]);',
    'let domain = hp[0];',
    'print(domain);']);
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes('let domain'));
  const h = await server.getHover(code, p, line, lines[line].indexOf('domain') + 3);
  expect(h?.contents?.value).toContain('string | null');
});

test('the always-true UC2009 no longer fires on the guarded tuple element', async () => {
  const { diags } = await run([
    'function split_host_port(s) {',
    '\tif (type(s) != "string") return [null, null];',
    '\tlet m = match(s, /^(.*):([0-9]+)$/);',
    '\tif (m) return [m[1], m[2]];',
    '\treturn [s, null];',
    '}',
    'let hp = split_host_port(ARGV[0]);',
    'let domain = hp[0];',
    'if (domain && domain != "") print(domain);']);
  expect(diags.filter((d) => String(d.code) === 'UC2009')).toEqual([]);
});

test('an unknown-element member is retained in the indexed union, not dropped', async () => {
  // One ternary branch is array<string>, the other an untyped array — the read
  // may be anything, so the element union must keep unknown (no over-claim).
  const { code, p } = await run([
    '/** @param {array} blob */',
    'function pick(blob) {',
    '\tlet r = length(ARGV) > 0 ? ["a", "b"] : blob;',
    '\tlet e = r[0];',
    '\treturn e;',
    '}',
    'print(pick([]));']);
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes('let e ='));
  const h = await server.getHover(code, p, line, lines[line].indexOf('e =') + 0);
  // Must not claim a bare `string | null` — the untyped-array branch is unknown.
  const v = h?.contents?.value ?? '';
  expect(v).not.toBe('(variable) **e**: `string | null`');
  if (v.includes('string')) expect(v).toContain('unknown');
});

test('`x == null || x.prop` narrows x non-null on the right of the ||', async () => {
  const { diags } = await run([
    'function maybe_obj(t) {',
    '\tif (type(t) == "string") return null;',
    '\treturn { a: 5 };',
    '}',
    'let a = maybe_obj(ARGV[0]);',
    'let result = a == null || a.a;',
    'print(result);']);
  expect(diags.filter((d) => /may be null|is null/.test(d.message))).toEqual([]);
});

test('`t != "string" || match(v, …)` proves v is a string at the match (alias form)', async () => {
  const { diags } = await run([
    'function is_timer(v) {',
    '\tlet t = type(v);',
    '\tif (t != "string" || !match(v, /^[0-9]+$/))',
    '\t\treturn false;',
    '\treturn true;',
    '}',
    'print(is_timer(ARGV[0]));']);
  expect(diags.filter((d) => /match\(\) is unknown|match\(\) may be/.test(d.message))).toEqual([]);
});

test('|| does NOT narrow when the left guard is null-propagating', async () => {
  // `length(x) > 2 || use(x)` — a false length test does not mean x is null or
  // any particular type; the flip must be skipped for null-propagation guards.
  const { code, p } = await run([
    'let x = ARGV[0];',
    'let ok = length(x) > 2 || x == null;',
    'print(ok, x);']);
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes('x == null'));
  const h = await server.getHover(code, p, line, lines[line].indexOf('x == null') + 0);
  expect(h?.contents?.value ?? '').toContain('string | null');
});
