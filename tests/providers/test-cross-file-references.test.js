// Cross-file references — edge-case matrix.
// A textDocument/references query resolves the symbol to its declaring file and
// fans out across the workspace, from any query site (export / import / usage),
// across named/default/namespace/aliased imports and subdirectories.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = '/tmp/test-xref-matrix';

const FILES = {
  'lib.uc':
`export function foo() { return 1; }
export function bar() { return foo(); }
export let CONST = 42;
export function make() {
    return { run: function(a, b) { return a + b; } };
}
export function nsmem() { return 3; }
export default function dflt() { return 9; }
`,
  'main.uc':
`import { foo, CONST } from './lib.uc';
import { make } from './lib.uc';
import dflt from './lib.uc';
let w = make();
let r = foo();
let s = foo() + CONST;
let t = dflt();
let u = w.run(1, 2);
`,
  'other.uc':
`import { foo } from './lib.uc';
let y = foo();
`,
  'aliasref.uc':
`import { foo as fa } from './lib.uc';
let z = fa() + fa();
`,
  'nsuser.uc':
`import * as lib from './lib.uc';
let q = lib.nsmem();
let p = lib.foo();
`,
  'unrelated.uc':
`function foo() { return 100; }
let n = foo();
`,
  'deep/sub.uc':
`import { foo } from '../lib.uc';
let d = foo();
`,
};

let server;
beforeAll(async () => {
  fs.mkdirSync(path.join(ws, 'deep'), { recursive: true });
  for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(path.join(ws, name), content);
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

// Column of the nth (1-based) occurrence of `token` on a given line of a file.
function colOf(file, lineIdx, token, nth = 1) {
  const line = FILES[file].split('\n')[lineIdx];
  const re = new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  let m, count = 0;
  while ((m = re.exec(line)) !== null) { if (++count === nth) return m.index; }
  return line.indexOf(token);
}
async function rawRefsAt(file, lineIdx, token, { nth = 1, includeDeclaration = true } = {}) {
  const fp = path.join(ws, file);
  const refs = (await server.getReferences(FILES[file], fp, lineIdx, colOf(file, lineIdx, token, nth), includeDeclaration)) || [];
  return refs.map((r) => {
    const rel = path.relative(ws, r.uri.replace('file://', ''));
    return `${rel}:${r.range.start.line}:${r.range.start.character}`;
  });
}
async function refsAt(file, lineIdx, token, opts = {}) {
  return (await rawRefsAt(file, lineIdx, token, opts)).map((k) => k.split(':').slice(0, 2).join(':'));
}

test('R1: references of a named export from a usage site span all importers', async () => {
  const got = await refsAt('main.uc', 4, 'foo'); // `let r = foo();`
  for (const k of ['lib.uc:0', 'lib.uc:1', 'main.uc:4', 'main.uc:5', 'other.uc:1', 'aliasref.uc:1', 'nsuser.uc:2', 'deep/sub.uc:1']) {
    expect(got).toContain(k);
  }
});

test('R2: same set when queried from the export/declaration site', async () => {
  const got = await refsAt('lib.uc', 0, 'foo');
  for (const k of ['lib.uc:0', 'main.uc:4', 'other.uc:1', 'aliasref.uc:1', 'nsuser.uc:2', 'deep/sub.uc:1']) {
    expect(got).toContain(k);
  }
});

test('R3: same set when queried from another importer', async () => {
  const got = await refsAt('other.uc', 1, 'foo');
  expect(got).toContain('lib.uc:0');
  expect(got).toContain('main.uc:4');
  expect(got).toContain('aliasref.uc:1');
});

test('R4: an ALIASED import usage is included (import { foo as fa })', async () => {
  const got = await refsAt('main.uc', 4, 'foo');
  expect(got).toContain('aliasref.uc:1'); // fa() usages
});

test('R5: a subdirectory importer (../lib) is found', async () => {
  const got = await refsAt('lib.uc', 0, 'foo');
  expect(got).toContain('deep/sub.uc:1');
});

test('R6: an unrelated same-named local is NOT matched', async () => {
  const got = await refsAt('main.uc', 4, 'foo');
  expect(got.some((k) => k.startsWith('unrelated.uc'))).toBe(false);
});

test('R7: querying that unrelated local stays in its own file', async () => {
  const got = await refsAt('unrelated.uc', 1, 'foo');
  expect(got.every((k) => k.startsWith('unrelated.uc'))).toBe(true);
  expect(got.some((k) => k.startsWith('lib.uc'))).toBe(false);
});

test('R8: exported VARIABLE references span files', async () => {
  const got = await refsAt('main.uc', 5, 'CONST'); // `let s = foo() + CONST;`
  expect(got).toContain('lib.uc:2'); // declaration
  expect(got).toContain('main.uc:5'); // usage
});

test('R9: default-export references reach importers', async () => {
  const got = await refsAt('main.uc', 6, 'dflt');
  expect(got).toContain('lib.uc:7');
  expect(got).toContain('main.uc:6');
});

test('R10: a factory function name references span files', async () => {
  const got = await refsAt('main.uc', 3, 'make'); // `let w = make();`
  expect(got).toContain('lib.uc:3');
  expect(got).toContain('main.uc:3');
});

test('R11: a factory-returned METHOD is found cross-file from the source side', async () => {
  const got = await refsAt('lib.uc', 4, 'run'); // the `run:` method in make()'s return
  expect(got).toContain('main.uc:7'); // `w.run(1, 2)`
});

test('R12: a namespace member usage is found from the source side', async () => {
  const got = await refsAt('lib.uc', 6, 'nsmem');
  expect(got).toContain('nsuser.uc:1'); // lib.nsmem()
});

test('R13: includeDeclaration=false drops a local variable declaration', async () => {
  const withDecl = await refsAt('main.uc', 3, 'w'); // `let w = make();`
  const without = await refsAt('main.uc', 3, 'w', { includeDeclaration: false });
  expect(withDecl).toContain('main.uc:3');
  expect(without).not.toContain('main.uc:3');
  expect(without).toContain('main.uc:7'); // the w.run usage remains
});

test('R14: a purely-local variable resolves in-file only', async () => {
  const got = await refsAt('main.uc', 3, 'w');
  expect(got.every((k) => k.startsWith('main.uc'))).toBe(true);
});

test('R15: a function parameter resolves in-file only', async () => {
  const got = await refsAt('lib.uc', 4, 'a'); // param `a` of run
  expect(got.every((k) => k.startsWith('lib.uc'))).toBe(true);
});

test('R16: an internally-used export with no importers stays in its file', async () => {
  // bar() is exported but imported nowhere; its only occurrence is its declaration.
  const got = await refsAt('lib.uc', 1, 'bar');
  expect(got.every((k) => k.startsWith('lib.uc'))).toBe(true);
});

test('R17: results are deduplicated (by full range)', async () => {
  const got = await rawRefsAt('main.uc', 4, 'foo'); // line:char keys
  expect(got.length).toBe(new Set(got).size);
});

test('R18: querying the import SPECIFIER identifier resolves the same symbol', async () => {
  const got = await refsAt('main.uc', 0, 'foo'); // the `foo` in `import { foo, CONST }`
  expect(got).toContain('lib.uc:0');
  expect(got).toContain('other.uc:1');
});

test('R19: CONST queried from its declaration spans importers', async () => {
  const got = await refsAt('lib.uc', 2, 'CONST');
  expect(got).toContain('main.uc:5');
});

test('R20: foo appears at BOTH usages within main', async () => {
  const got = await refsAt('main.uc', 4, 'foo');
  expect(got).toContain('main.uc:4');
  expect(got).toContain('main.uc:5');
});

test('R21: bar references include foo usage, not bar itself, when querying foo', async () => {
  const got = await refsAt('lib.uc', 1, 'foo'); // foo() inside bar
  expect(got).toContain('lib.uc:1'); // the foo() call site
  expect(got).toContain('main.uc:4');
});

test('R22: namespace member from the IMPORTER side resolves cross-file', async () => {
  // click `foo` in nsuser.uc `lib.foo()` — previously returned nothing.
  const got = await refsAt('nsuser.uc', 2, 'foo');
  expect(got).toContain('lib.uc:0');   // declaration
  expect(got).toContain('main.uc:4');  // another importer's usage
  expect(got).toContain('nsuser.uc:2'); // the lib.foo() site itself
});

test('R23: factory-returned method from the IMPORTER side resolves cross-file', async () => {
  // click `run` in main.uc `w.run(1, 2)` (w = make()) — previously returned nothing.
  const got = await refsAt('main.uc', 7, 'run');
  expect(got).toContain('main.uc:7');
});
