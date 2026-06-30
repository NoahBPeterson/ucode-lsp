// fs.* return types must survive ternary / `??` / for-in inference, instead of
// collapsing a nullable-union branch to `unknown`:
//   A) `for (e in lsdir() ?? [])`        → e: string        (was unknown)
//   B) `let d = readfile(p); d ? d : null`→ returns string|null (was unknown|null)
//   C) `cond ? lsdir() : null`           → array<string>|null (was unknown|null)
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const fp = () => `/tmp/fsinf-${n++}.uc`;
async function hover(content, lineIdx, character) {
  const h = await server.getHover(content, fp(), lineIdx, character);
  if (!h) return '';
  const c = h.contents;
  return typeof c === 'string' ? c : (c?.value ?? (Array.isArray(c) ? c.map(x => x?.value ?? x).join('\n') : ''));
}

// C) ternary with an array<string>|null consequent
test('C: `cond ? lsdir() : null` infers array<string> | null (not unknown)', async () => {
  const code = "import { lsdir, access } from 'fs';\nlet dir = access('/x') ? lsdir('/x') : null;\n";
  const h = await hover(code, 1, code.split('\n')[1].indexOf('dir') + 1);
  expect(h).toMatch(/array/);
  expect(h).toMatch(/null/);
  expect(h).not.toMatch(/unknown/);
});

// B) ternary `d ? d : null` as a function's return value
test('B: `readfile(p); return d ? d : null` returns string | null (not unknown)', async () => {
  const code = "import { readfile } from 'fs';\nfunction rf(p) { let d = readfile(p); return d ? d : null; }\n";
  const h = await hover(code, 1, code.split('\n')[1].indexOf('rf') + 1);
  expect(h).toMatch(/string/);
  expect(h).not.toMatch(/unknown/);
});

// A) for-in over `lsdir() ?? []`
test('A: `for (e in lsdir() ?? [])` infers e: string (not unknown)', async () => {
  const code = "import { lsdir } from 'fs';\nfor (let e in (lsdir('/x') ?? [])) print(e);\n";
  const h = await hover(code, 1, code.split('\n')[1].indexOf('e in') );
  expect(h).toMatch(/string/);
  expect(h).not.toMatch(/unknown/);
});

// Ternary fix is ORDER-INDEPENDENT: branches unioned regardless of position.
test('ternary symmetry: `cond ? null : lsdir()` is array<string> | null', async () => {
  const code = "import { lsdir, access } from 'fs';\nlet dir = access('/x') ? null : lsdir('/x');\n";
  const h = await hover(code, 1, code.split('\n')[1].indexOf('dir') + 1);
  expect(h).toMatch(/array/);
  expect(h).toMatch(/null/);
  expect(h).not.toMatch(/unknown/);
});

// `??` is asymmetric by definition — the empty-array fallback only helps on the RIGHT.
// `[] ?? lsdir()` is degenerate: `[]` is never null, so it always wins (lsdir is dead);
// the result is a bare `array` (element type genuinely unknown — and it's a no-op idiom).
test('?? asymmetry: `[] ?? lsdir()` returns the (never-null) left, a bare array', async () => {
  const code = "import { lsdir } from 'fs';\nlet dir = [] ?? lsdir('/x');\n";
  const h = await hover(code, 1, code.split('\n')[1].indexOf('dir') + 1);
  expect(h).toMatch(/array/);
});
