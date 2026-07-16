// Regression for docs/tc-barrel-reexport-typing.md — a module that re-exports
// another module's members as `const`s (the barrel pattern) previously typed
// every re-exported name as `unknown` on the importer side, because
// findExports/getNamedExportTypeInfo never looked at the declarator's
// initializer when it aliased an imported symbol. Covers the ticket's exact
// 3-file repro (function-member re-export), a namespace re-export, and the
// two-hop `mock.global.patch` chain (namespace re-export of a namespace
// re-export), plus a cycle guard and a non-import initializer staying as-is.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const base = '/tmp/test-barrel-reexport-typing';
const ws = path.join(base, 'ws');
const FILES = {
  // --- Ticket's exact repro: function-member re-export ---
  'leaf2.uc': 'export function truthy() { return true; }\n',
  'mid2.uc': "import * as _c from './leaf2.uc';\nexport const truthy = _c.truthy;\n",

  // --- Namespace re-export: `export const mock = _mock;` ---
  'ns_leaf.uc': 'export function spy() { return 1; }\nexport const VAL = 42;\n',
  'ns_mid.uc': "import * as _mock from './ns_leaf.uc';\nexport const mock = _mock;\n",

  // --- Two-hop: a namespace re-export OF a namespace re-export
  // (mirrors utest.uc `export const mock = _mock` -> utest/mock.uc
  // `export const global = _global`) ---
  'hop_inner.uc': 'export function patch() { return "patched"; }\n',
  'hop_middle.uc': "import * as _global from './hop_inner.uc';\nexport const global = _global;\n",
  'hop_outer.uc': "import * as _mock from './hop_middle.uc';\nexport const mock = _mock;\n",

  // --- Cycle guard: two files re-exporting each other's identically-named
  // member must not hang ---
  'cycle_a.uc': "import * as _b from './cycle_b.uc';\nexport const val = _b.val;\n",
  'cycle_b.uc': "import * as _a from './cycle_a.uc';\nexport const val = _a.val;\n",

  // --- Non-import initializer keeps its literal typing (not affected) ---
  'plain.uc': 'export const x = 5;\n',
};

let server;
beforeAll(async () => {
  for (const [name, content] of Object.entries(FILES)) {
    const p = path.join(ws, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });

const text = (h) => (!h || !h.contents) ? '' : (typeof h.contents === 'string' ? h.contents : (h.contents.value || ''));
function posOf(code, sub, occ = 1) {
  let i = -1;
  for (let k = 0; k < occ; k++) { i = code.indexOf(sub, i + 1); if (i === -1) throw new Error('not found: ' + sub); }
  const pre = code.slice(0, i);
  return { line: (pre.match(/\n/g) || []).length, character: i - (pre.lastIndexOf('\n') + 1) + 1 };
}
const diagsAt = (content, file) => server.getDiagnostics(content, path.join(ws, file));
const hoverAt = (content, file, sub, occ) => {
  const p = posOf(content, sub, occ);
  return server.getHover(content, path.join(ws, file), p.line, p.character);
};
const unknownCount = (d) => d.filter((x) => /unknown/i.test(x.message)).length;

describe('barrel re-export through a function member (ticket repro)', () => {
  const MAIN = "import { truthy } from './mid2.uc';\nlet result = truthy();\n";

  test('the re-exported function name types as function, not unknown', async () => {
    const h = await hoverAt(MAIN, 'main2.uc', 'truthy');
    expect(text(h)).toContain('function');
    expect(text(h)).not.toContain('unknown');
  });

  test('the call result types as boolean, not unknown', async () => {
    const h = await hoverAt(MAIN, 'main2.uc', 'result');
    expect(text(h)).toContain('bool');
  });
});

describe('barrel re-export of a whole namespace', () => {
  const MAIN = "import { mock } from './ns_mid.uc';\nlet nsVal = mock.VAL;\n";

  test('a member of the re-exported namespace resolves (not unknown)', async () => {
    const h = await hoverAt(MAIN, 'ns_main.uc', 'nsVal');
    expect(text(h)).not.toContain('unknown');
  });
});

describe('two-hop barrel chain (mock.global.patch shape)', () => {
  const MAIN = "import { mock } from './hop_outer.uc';\nmock.global.patch();\n";

  test('a two-hop namespace member call resolves without a diagnostic error', async () => {
    const d = await diagsAt(MAIN, 'hop_main.uc');
    expect(d.filter((x) => x.severity === 1)).toEqual([]);
  });
});

describe('re-export cycles do not hang', () => {
  test('a mutually re-exporting pair resolves in bounded time', async () => {
    const MAIN = "import { val } from './cycle_a.uc';\nprint(val);\n";
    const d = await diagsAt(MAIN, 'cycle_main.uc');
    // No crash / hang is the primary assertion; a module-not-found would be a
    // real regression.
    expect(d.filter((x) => x.code === 'UC3002')).toEqual([]);
  });
});

describe('non-import initializer is unaffected', () => {
  test('`export const x = 5;` still types as its literal value', async () => {
    const MAIN = "import { x } from './plain.uc';\nlet plainVal = x;\n";
    const h = await hoverAt(MAIN, 'plain_main.uc', 'plainVal');
    expect(text(h)).toContain('integer');
  });
});
