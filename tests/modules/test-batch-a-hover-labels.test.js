// Batch A — hover / type-label fixes:
//  - #147 trace() hover doc: param is `level` (integer), returns the PREVIOUS trace level
//         (integer), not `message`/`null` (verified vs ucode/lib.c uc_trace).
//  - #149 proto() hover doc: 2-arg set-form returns the object itself, not the prototype
//         (verified vs ucode/lib.c uc_proto).
//  - #163 a struct.buffer (and other handle object-type) value must hover as its bare type
//         name, not "struct.buffer module".
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const hoverText = async (code, line, char) => {
  const h = await s.getHover(code, `/tmp/ba-hov-${n++}.uc`, line, char);
  return (h && h.contents && (typeof h.contents === 'string' ? h.contents : h.contents.value)) || '';
};

// ── #147: trace hover ──
test('trace() hover documents the level:integer param and integer return', async () => {
  const t = await hoverText("trace(1);\n", 0, 1);
  expect(t).toContain('level');
  expect(t).toContain('trace level');
  expect(t).not.toContain('`message`');
  expect(t).not.toMatch(/\*\*Returns:\*\*\s*`null`/);
});

// ── #149: proto hover ──
test('proto() hover explains the 2-arg set-form returns the object itself', async () => {
  const t = await hoverText("proto({});\n", 0, 1);
  expect(t).toContain('returns `value` itself');
});

// ── #163: struct.buffer handle type label (no " module" suffix) ──
test('a struct.buffer value hovers as its bare type, not "struct.buffer module"', async () => {
  const SRC = "import * as struct from 'struct';\nlet b = struct.buffer();\nlet x = b;\n";
  const t = await hoverText(SRC, 2, SRC.split('\n')[2].indexOf('x'));
  expect(t).toContain('struct.buffer');
  expect(t).not.toContain('struct.buffer module');
});
test('a genuine module reference still hovers with the " module" suffix', async () => {
  // regression guard: importing a module namespace must keep "<name> module".
  const SRC = "import * as fs from 'fs';\nprint(fs);\n";
  const t = await hoverText(SRC, 1, SRC.split('\n')[1].indexOf('fs'));
  expect(t).toContain('fs module');
});
