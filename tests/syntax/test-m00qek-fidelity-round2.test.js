// m00qek-fidelity-round2: parse-time divergences from real ucode, found by diffing
// tree-sitter-ucode v0.7.0..v0.8.0 against our lexer and parser. Every case here was
// verified against a build of the vendored ucode tree (3ec4e5c), not just read off the
// C source. See docs/done/m00qek-parser-fidelity-2.md.
//
// Reported by m00qek (https://github.com/m00qek) while building tree-sitter-ucode.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const uri = () => `/tmp/m00qek-r2-${n++}.uc`;
const diags = async (code) => (await server.getDiagnostics(code, uri())) || [];
const byCode = async (code, c) => (await diags(code)).filter((d) => d.code === c);

// ── UC6018: numeric object keys ──────────────────────────────────────────────
// ucode's object parser matches only a label or a string at the key position
// (compiler.c:2246-2250, "Expecting label"); computed `[1]:` is the escape hatch.
test('bare numeric key {1: 2} is an error', async () => {
  const ds = await byCode('let o = {1: 2};\nprint(o);\n', 'UC6018');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('Numeric object key');
});
test('numeric key diagnostic anchors on the key token', async () => {
  const ds = await byCode('let o = {1: 2};\n', 'UC6018');
  // `let o = {1: 2};` — the key is at character 9
  expect(ds[0].range.start.line).toBe(0);
  expect(ds[0].range.start.character).toBe(9);
  expect(ds[0].range.end.character).toBe(10);
});
test('a double key {1.5: 2} is flagged too', async () => {
  expect((await byCode('let o = {1.5: 2};\nprint(o);\n', 'UC6018')).length).toBe(1);
});
test('each numeric key gets its own diagnostic', async () => {
  expect((await byCode('let o = {1: "a", 2: "b"};\nprint(o);\n', 'UC6018')).length).toBe(2);
});
test('a numeric key does not swallow later diagnostics', async () => {
  const ds = await diags('let o = {1: "a"};\nprint(nope);\n');
  expect(ds.some((d) => /Undefined variable: nope/.test(d.message))).toBe(true);
});
test('quoted key {"1": 2} is clean', async () => {
  expect((await byCode('let o = {"1": 2};\nprint(o);\n', 'UC6018')).length).toBe(0);
});
test('computed key {[1]: 2} is clean', async () => {
  expect((await byCode('let o = {[1]: 2};\nprint(o);\n', 'UC6018')).length).toBe(0);
});
test('label key {a: 1} is clean', async () => {
  expect((await byCode('let o = {a: 1};\nprint(o);\n', 'UC6018')).length).toBe(0);
});

// ── UC6019: empty import / export lists ──────────────────────────────────────
// Both list parsers are do/while loops that consume a specifier before they ever
// check for '}' (compiler.c:3300-3307 export, :3770-3790 import), so `{}` is a
// syntax error rather than an inert no-op.
test('import {} from "…" is an error', async () => {
  const ds = await byCode('import {} from "./mod.uc";\n', 'UC6019');
  expect(ds.length).toBe(1);
  expect(ds[0].severity).toBe(1);
  expect(ds[0].message).toContain('Empty import list');
});
test('export {} is an error', async () => {
  const ds = await byCode('export {};\n', 'UC6019');
  expect(ds.length).toBe(1);
  expect(ds[0].message).toContain('Empty export list');
});
test('empty import list does not cascade into an undefined-variable report for `from`', async () => {
  const ds = await diags('import {} from "./mod.uc";\n');
  expect(ds.filter((d) => /Undefined variable: from/.test(d.message)).length).toBe(0);
});
test('empty named-import list after a default import is flagged', async () => {
  expect((await byCode('import def, {} from "./mod.uc";\n', 'UC6019')).length).toBe(1);
});
test('an empty list does not swallow later diagnostics', async () => {
  const ds = await diags('export {};\nprint(nope);\n');
  expect(ds.some((d) => /Undefined variable: nope/.test(d.message))).toBe(true);
});
test('non-empty import list is clean', async () => {
  expect((await byCode('import { cursor } from "uci";\nprint(cursor);\n', 'UC6019')).length).toBe(0);
});
test('bare side-effect import stays clean', async () => {
  expect((await byCode('import "./mod.uc";\n', 'UC6019')).length).toBe(0);
});
test('non-empty export list is clean', async () => {
  expect((await byCode('let v = 1;\nexport { v };\n', 'UC6019')).length).toBe(0);
});

// ── lexer: regex literals spanning newlines (valid ucode) ────────────────────
// ucode lexes /…/ with parse_string(lex, '/') (lexer.c:490-497) — the same routine
// as string literals — so raw newlines are ordinary pattern content and only EOF
// leaves a regex unterminated.
const syntaxish = async (code) =>
  (await diags(code)).filter((d) => d.severity === 1 && String(d.code || '').startsWith('UC6'));

test('a multi-line regex literal is clean', async () => {
  expect((await syntaxish('let r = /foo\nbar/;\nprint(r);\n')).length).toBe(0);
});
test('a multi-line regex literal with flags is clean', async () => {
  expect((await syntaxish('let r = /a\nb/g;\nprint(r);\n')).length).toBe(0);
});
test('a newline inside a character class is clean', async () => {
  expect((await syntaxish('let r = /[a\nb]/;\nprint(r);\n')).length).toBe(0);
});
test('a stray slash is still reported, and recovery stays line-local', async () => {
  // Allowing newlines must not let an unterminated '/' swallow the file: the
  // following statement still parses, so `nope` is still reported undefined.
  const ds = await diags('let x = 1;\nx = / oops\nprint(nope);\n');
  expect(ds.some((d) => /Did you mean to use a comment/.test(d.message))).toBe(true);
  expect(ds.some((d) => /Undefined variable: nope/.test(d.message))).toBe(true);
});
test('plain division is not lexed as a regex', async () => {
  expect((await syntaxish('let a = 10, b = 2;\nprint(a / b);\n')).length).toBe(0);
});
test('an ordinary single-line regex is clean', async () => {
  expect((await syntaxish('let re = /foo/;\nprint(match("foo", re));\n')).length).toBe(0);
});
