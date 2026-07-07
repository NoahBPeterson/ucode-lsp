// Batch I provider fixes — completion tickets 97, 98, 99, 100, 172, 174, 176.
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-batch-i-completion.uc');

async function completeAt(content, line, character) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const r = await server.getCompletions(content, fp, line, character);
    const items = Array.isArray(r) ? r : (r && r.items) || [];
    return items;
  } finally {
    server.shutdown();
  }
}
const labels = (items) => items.map((i) => i.label);

// #97 — require("…") completes module names for a bare arg.
test('#97 require() bare arg offers module names not builtins', async () => {
  const items = await completeAt(`let m = require('');\n`, 0, 16); // inside quotes
  const ls = labels(items);
  expect(ls).toContain('fs');
  expect(ls).not.toContain('printf');
});

// #98 — let/const/for-init declarator name position offers nothing.
test('#98 let name position suppresses builtins', async () => {
  const items = await completeAt(`let pri\n`, 0, 7);
  expect(items.length).toBe(0);
});

test('#98 const name position suppresses builtins', async () => {
  const items = await completeAt(`const \n`, 0, 6);
  expect(items.length).toBe(0);
});

test('#98 init expression still completes (let x = lo|)', async () => {
  const items = await completeAt(`let x = lo\n`, 0, 10);
  expect(labels(items)).toContain('localtime');
});

// #99 — object-literal key position suppresses the builtin flood.
test('#99 object-literal key position suppresses builtins', async () => {
  const items = await completeAt(`let o = { p };\n`, 0, 11); // after p
  expect(items.length).toBe(0);
});

test('#99 object-literal value position still completes', async () => {
  const items = await completeAt(`let o = { a: lo };\n`, 0, 15); // after lo
  expect(labels(items)).toContain('localtime');
});

// #100 — a user local outranks ambient globals in sortText.
test('#100 local sorts ahead of ambient globals', async () => {
  const items = await completeAt(`let myLocal = 1;\n\n`, 1, 0);
  const mine = items.find((i) => i.label === 'myLocal');
  const argv = items.find((i) => i.label === 'ARGV');
  expect(mine).toBeTruthy();
  expect(argv).toBeTruthy();
  expect(mine.sortText < argv.sortText).toBe(true);
});

// #172 — keyword completion includes switch/case/import etc. from the lexer map.
test('#172 keyword set includes switch/case/import/delete', async () => {
  const items = await completeAt(`\n`, 0, 0);
  const kw = items.filter((i) => i.detail === 'ucode keyword').map((i) => i.label);
  for (const k of ['switch', 'case', 'default', 'import', 'export', 'delete', 'in']) {
    expect(kw).toContain(k);
  }
  // No `throw` (not a ucode keyword), no template-only `elif`/`endif`.
  expect(kw).not.toContain('throw');
  expect(kw).not.toContain('elif');
  expect(kw).not.toContain('endif');
});

// #174 — member completion on `opts || {}` / ternary / `??` result.
test('#174 member completion after `opts || {}`', async () => {
  const content = `let opts = { aa: 1 };\nlet result = opts || {};\nresult.\n`;
  const items = await completeAt(content, 2, 7);
  expect(labels(items)).toContain('aa');
});

test('#174 member completion after ternary', async () => {
  const content = `let o1 = { bb: 1 };\nlet o2 = { cc: 2 };\nlet r = true ? o1 : o2;\nr.\n`;
  const items = await completeAt(content, 3, 2);
  const ls = labels(items);
  expect(ls).toContain('bb');
  expect(ls).toContain('cc');
});

// #176 — for-in over array<object> loop var member completion.
test('#176 for-in loop var member completion', async () => {
  const content = `let arr = [ { x: 1 } ];\nfor (let v in arr) {\n  v.\n}\n`;
  const items = await completeAt(content, 2, 4);
  expect(labels(items)).toContain('x');
});
