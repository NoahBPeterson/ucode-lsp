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

test('signature help for a module-namespace method (fs.open) with optional params', async () => {
  const code = `import * as fs from 'fs';\nfunction f() { let h = fs.open("/etc/x", "r"); }`;
  const p = at(code, 'fs.open("/etc/x", ', 'fs.open("/etc/x", '.length); // cursor at the 2nd arg
  const sh = await server.getSignatureHelp(code, FILE, p.line, p.character);
  expect(sh).not.toBeNull();
  expect(sh.signatures[0].label).toBe('fs.open(path, mode?, perm?)');
  expect(sh.activeParameter).toBe(1);
});

test('signature help for an object-type method (fs.file handle .read)', async () => {
  const code = `import * as fs from 'fs';\nfunction f() {\n  let h = fs.open("/x", "r");\n  h.read(1024);\n}`;
  const p = at(code, 'h.read(', 'h.read('.length);
  const sh = await server.getSignatureHelp(code, FILE, p.line, p.character);
  expect(sh).not.toBeNull();
  expect(sh.signatures[0].label.startsWith('h.read(')).toBe(true);
});

// ── Inlay hints ──────────────────────────────────────────────────────────────
test('inlay hints: variable type hint for a non-obvious init + parameter-name hints', async () => {
  const code = `import * as fs from 'fs';\nfunction f() {\n  let h = fs.open("/x", "r");\n  substr("hi", 1, 2);\n}`;
  const hints = await server.getInlayHints(code, FILE, { line: 0, character: 0 }, { line: 5, character: 0 });
  const labels = (hints || []).map(h => h.label);
  expect(labels).toContain(': fs.file | null');   // type hint on `let h = fs.open(...)`
  expect(labels).toContain('path:');               // param-name hints for fs.open
  expect(labels).toContain('string:');             // param-name hints for substr
  expect(labels).toContain('length:');
});

test('inlay hints: obvious literal inits get no type hint', async () => {
  const code = `function f() {\n  let n = 5;\n  let s = "hi";\n}`;
  const hints = await server.getInlayHints(code, FILE, { line: 0, character: 0 }, { line: 3, character: 0 });
  const typeHints = (hints || []).filter(h => h.kind === 1); // InlayHintKind.Type
  expect(typeHints.length).toBe(0);
});

// ── Quick fix: add missing module import (UC3006) ────────────────────────────
test('UC3006 (module used without importing) offers add-import quick fixes', async () => {
  const code = `function f() {\n  let h = fs.open('/', 'r');\n}`;
  const ds = await server.getDiagnostics(code, FILE);
  const d = (ds || []).find(x => x.code === 'UC3006');
  expect(d).toBeTruthy();
  const acts = await server.getCodeActions(FILE, [d], d.range.start.line, d.range.start.character);
  const titles = (acts || []).map(a => a.title);
  expect(titles).toContain("Add import { open } from 'fs';");
  expect(titles).toContain("Add import * as fs from 'fs';");
});

// ── Completion on function-local module/handle variables ────────────────────
test('completion resolves a function-local module-typed variable', async () => {
  // `_ubus = ubus_mod || require('ubus')` → _ubus is a ubus module; `_ubus.`
  // must list ubus functions even though _ubus is a function-LOCAL.
  const code = `/** @param {module:ubus|null} ubus_mod */\nfunction f(ubus_mod) {\n  let _ubus = ubus_mod || require('ubus');\n  _ubus.\n}`;
  const c = await server.getCompletions(code, FILE, 3, '  _ubus.'.length);
  const items = Array.isArray(c) ? c : (c && c.items) || [];
  expect(items.length).toBeGreaterThan(0);
  expect(items.map(i => i.label)).toContain('connect');
});

test('completion resolves a function-local object-type handle', async () => {
  const code = `import * as fs from 'fs';\nfunction f() {\n  let h = fs.open('/x', 'r');\n  h.\n}`;
  const c = await server.getCompletions(code, FILE, 3, '  h.'.length);
  const items = Array.isArray(c) ? c : (c && c.items) || [];
  expect(items.map(i => i.label)).toContain('read');
});

// ── Workspace symbols ────────────────────────────────────────────────────────
test('workspace symbols: query matches symbols in the open document', async () => {
  const code = `function zzqq_unique_handler() { return 1; }\nlet zzqq_unique_const = 2;`;
  const syms = await server.getWorkspaceSymbols(code, FILE, 'zzqq_unique');
  const names = (syms || []).map(s => s.name).sort();
  expect(names).toContain('zzqq_unique_handler');
  expect(names).toContain('zzqq_unique_const');
});
