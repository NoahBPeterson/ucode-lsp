const { test, expect, beforeAll, afterAll } = require('bun:test');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// End-to-end tests for the navigation/refactor LSP features:
//   references · document symbols · document highlight · rename · signature help
// Each goes through the real server (createLSPTestServer spawns dist/server.js).

let server;
const FILE = path.join(os.tmpdir(), 'lsp-nav-test.uc');
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { if (server) server.shutdown(); });

// line/character of the Nth occurrence of `needle` in `code`, offset `into` chars in.
function at(code, needle, into = 0, occurrence = 1) {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) idx = code.indexOf(needle, idx + 1);
  const abs = idx + into;
  const pre = code.slice(0, abs);
  const line = (pre.match(/\n/g) || []).length;
  const character = abs - (pre.lastIndexOf('\n') + 1);
  return { line, character };
}

// ── References ───────────────────────────────────────────────────────────────
test('find all references: declaration + usages, scope-aware (shadow excluded)', async () => {
  const code = `function helper(x) { return x + 1; }
function main() {
  let a = helper(1);
  let b = helper(2);
  let helper = 5;
  return helper + a + b;
}`;
  const p = at(code, 'helper', 2); // inside the declaration name
  const refs = await server.getReferences(code, FILE, p.line, p.character, true);
  // decl (L1) + helper(1) (L3) + helper(2) (L4) = 3; the shadowing local + its use excluded
  expect((refs || []).length).toBe(3);
  const lines = refs.map(r => r.range.start.line).sort((a, b) => a - b);
  expect(lines).toEqual([0, 2, 3]);
});

test('references excludes the declaration when includeDeclaration=false', async () => {
  const code = `function helper() { return 1; }\nlet a = helper();\nlet b = helper();`;
  const p = at(code, 'helper');
  const refs = await server.getReferences(code, FILE, p.line, p.character, false);
  expect((refs || []).length).toBe(2); // two call sites, not the decl
});

// ── Document symbols ─────────────────────────────────────────────────────────
test('document symbols: functions, nested children, vars, object members', async () => {
  const code = `let TOP = 1;
function outer() {
  function inner() { return 1; }
  let local = 2;
}
let cfg = { host: "x", port: 80 };`;
  const syms = await server.getDocumentSymbols(code, FILE);
  const names = (syms || []).map(s => s.name);
  expect(names).toEqual(['TOP', 'outer', 'cfg']);
  const outer = syms.find(s => s.name === 'outer');
  expect(outer.children.map(c => c.name).sort()).toEqual(['inner', 'local']);
  const cfg = syms.find(s => s.name === 'cfg');
  expect(cfg.children.map(c => c.name).sort()).toEqual(['host', 'port']);
});

// ── Document highlight ───────────────────────────────────────────────────────
test('document highlight: all in-file occurrences of the symbol', async () => {
  const code = `function g() { let v = 1; v = v + 1; return v; }`;
  const p = at(code, 'let v', 4);
  const hl = await server.getHighlights(code, FILE, p.line, p.character);
  expect((hl || []).length).toBe(4); // decl, v=, v+1, return v
});

// ── Rename ───────────────────────────────────────────────────────────────────
test('rename a local: edits every occurrence', async () => {
  const code = `function f() {\n  let count = 0;\n  count = count + 1;\n  return count;\n}`;
  const p = at(code, 'count');
  const we = await server.getRename(code, FILE, p.line, p.character, 'total');
  const edits = we && we.changes ? we.changes[`file://${FILE}`] : null;
  expect((edits || []).length).toBe(4);
  expect(edits.every(e => e.newText === 'total')).toBe(true);
});

test('rename refuses exported / imported symbols (would break other files)', async () => {
  const exp = `export function pub() { return 1; }\nlet x = pub();`;
  const p = at(exp, 'pub');
  expect(await server.getRename(exp, FILE, p.line, p.character, 'renamed')).toBeNull();
  expect(await server.getPrepareRename(exp, FILE, p.line, p.character)).toBeNull();
});

test('prepareRename returns the identifier range for a renameable local', async () => {
  const code = `function f() { let n = 1; return n; }`;
  const p = at(code, 'let n', 4);
  const pr = await server.getPrepareRename(code, FILE, p.line, p.character);
  expect(pr).not.toBeNull();
  expect(pr.placeholder).toBe('n');
});

// ── Signature help ───────────────────────────────────────────────────────────
test('signature help for a builtin highlights the active parameter', async () => {
  const code = `function f() { let x = substr("hello", 1, 2); }`;
  const p = at(code, '"hello", ', '"hello", '.length); // cursor at the 2nd arg
  const sh = await server.getSignatureHelp(code, FILE, p.line, p.character);
  expect(sh).not.toBeNull();
  expect(sh.signatures[0].label).toBe('substr(string, start, length)');
  expect(sh.activeParameter).toBe(1);
});

test('signature help for a user function uses its parameter list', async () => {
  const code = `function greet(name, age) { return name; }\nlet r = greet("a", 3);`;
  const p = at(code, 'greet("a", ', 'greet("a", '.length); // cursor at the 2nd arg of the call
  const sh = await server.getSignatureHelp(code, FILE, p.line, p.character);
  expect(sh).not.toBeNull();
  expect(sh.signatures[0].label).toBe('greet(name, age)');
  expect(sh.activeParameter).toBe(1);
});
