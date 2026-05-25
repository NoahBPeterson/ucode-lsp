// End-to-end tests for Go to Definition (textDocument/definition).
//
// These drive the REAL LSP server over stdio (via the shared test server) and
// exercise src/definition.ts's handleDefinition + getSymbolDefinition +
// getImportedSymbolDefinition. This replaces the coverage that test-go-to-
// definition.js only faked (that one asserts against a mock symbol table and
// never loads the real module).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// line/character of the nth (1-based) occurrence of `sub` in `code`, pointing
// one char into the match so the cursor lands inside the identifier.
function posOf(code, sub, occurrence = 1) {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = code.indexOf(sub, idx + 1);
    if (idx === -1) throw new Error(`substring not found (${occurrence}x): ${sub}`);
  }
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const character = idx - (pre.lastIndexOf('\n') + 1) + 1;
  return { line, character };
}

describe('Go to Definition (e2e)', function () {
  this.timeout(15000);

  let getDefinition;
  let tmpDir;

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getDefinition = server.getDefinition;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-def-'));
  });

  after(function () {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('resolves a local function call to its declaration', async () => {
    const code = `function helper(x) {\n  return x + 1;\n}\nlet r = helper(5);\n`;
    const p = posOf(code, 'helper', 2); // the call site
    const def = await getDefinition(code, '/tmp/def-localfn.uc', p.line, p.character);
    assert.ok(def, 'expected a definition');
    assert.strictEqual(def.uri, 'file:///tmp/def-localfn.uc');
    assert.strictEqual(def.range.start.line, 0, 'should point to the function declaration line');
  });

  it('resolves clicking the function name at its own declaration', async () => {
    const code = `function helper(x) {\n  return x;\n}\nhelper(1);\n`;
    const p = posOf(code, 'helper', 1); // the declaration itself
    const def = await getDefinition(code, '/tmp/def-selfdecl.uc', p.line, p.character);
    assert.ok(def, 'expected a definition');
    assert.strictEqual(def.range.start.line, 0);
  });

  it('resolves a local variable usage to its declaration', async () => {
    const code = `let total = 10;\nlet doubled = total * 2;\nprint(doubled);\n`;
    const p = posOf(code, 'total', 2); // usage on line 1
    const def = await getDefinition(code, '/tmp/def-var.uc', p.line, p.character);
    assert.ok(def, 'expected a definition');
    assert.strictEqual(def.range.start.line, 0, 'should point to the variable declaration');
  });

  it('resolves a function parameter usage to the parameter', async () => {
    const code = `function f(param) {\n  return param + 1;\n}\n`;
    const p = posOf(code, 'param', 2); // usage in body
    const def = await getDefinition(code, '/tmp/def-param.uc', p.line, p.character);
    assert.ok(def, 'expected a definition');
    assert.strictEqual(def.range.start.line, 0, 'should point to the parameter on the declaration line');
  });

  it('returns null for a builtin function (no navigable definition)', async () => {
    const code = `let n = length([1, 2, 3]);\n`;
    const p = posOf(code, 'length');
    const def = await getDefinition(code, '/tmp/def-builtin.uc', p.line, p.character);
    assert.strictEqual(def, null, 'builtins have no definition to navigate to');
  });

  it('returns null for an undefined symbol', async () => {
    const code = `print(neverDeclared);\n`;
    const p = posOf(code, 'neverDeclared');
    const def = await getDefinition(code, '/tmp/def-undef.uc', p.line, p.character);
    assert.strictEqual(def, null);
  });

  it('is scope-aware: a parameter resolves to its own function, not an outer same-named symbol', async () => {
    const code =
      `let value = 1;\n` +
      `function outer(value) {\n` +
      `  return value + 1;\n` +   // line 2: usage resolves to the parameter (line 1), not the global (line 0)
      `}\n`;
    const p = posOf(code, 'value', 3); // 1: global decl, 2: param decl, 3: usage in body
    const def = await getDefinition(code, '/tmp/def-scope.uc', p.line, p.character);
    assert.ok(def, 'expected a definition');
    assert.strictEqual(def.range.start.line, 1, 'should resolve to the parameter, not the outer global');
  });

  it('resolves a method on a known object type to the object declaration', async () => {
    const code = `import { cursor } from 'uci';\nlet ctx = cursor();\nctx.get('network', 'wan');\n`;
    const p = posOf(code, 'get('); // the method name
    const def = await getDefinition(code, '/tmp/def-uci.uc', p.line, p.character);
    assert.ok(def, 'expected a definition');
    assert.strictEqual(def.range.start.line, 1, 'should navigate to the cursor object declaration');
  });

  it('resolves an imported symbol to its declaration in another file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'lib.uc'), 'export function libFn(a) {\n  return a;\n};\n');
    const mainPath = path.join(tmpDir, 'main.uc');
    const code = `import { libFn } from './lib.uc';\nlet r = libFn(3);\n`;
    fs.writeFileSync(mainPath, code);
    const p = posOf(code, 'libFn', 2); // the usage
    const def = await getDefinition(code, mainPath, p.line, p.character);
    assert.ok(def, 'expected a cross-file definition');
    assert.ok(def.uri.endsWith('/lib.uc'), `expected definition in lib.uc, got ${def.uri}`);
  });

  it('returns null for an import from an unresolvable module', async () => {
    const code = `import { ghost } from './does-not-exist.uc';\nlet x = ghost(1);\n`;
    const p = posOf(code, 'ghost', 2);
    const def = await getDefinition(code, '/tmp/def-noresolve.uc', p.line, p.character);
    assert.strictEqual(def, null);
  });

  it('returns null for an imported symbol missing from the target file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'partial.uc'), 'export function other() { return 1; };\n');
    const mainPath = path.join(tmpDir, 'main-missing.uc');
    const code = `import { missing } from './partial.uc';\nlet y = missing(2);\n`;
    fs.writeFileSync(mainPath, code);
    const p = posOf(code, 'missing', 2);
    const def = await getDefinition(code, mainPath, p.line, p.character);
    assert.strictEqual(def, null);
  });

  it('keeps serving definitions after an import-failure path (no stream corruption)', async () => {
    const code = `function ok(z) {\n  return z;\n}\nok(1);\n`;
    const p = posOf(code, 'ok', 2);
    const def = await getDefinition(code, '/tmp/def-after-fail.uc', p.line, p.character);
    assert.ok(def, 'server should still respond correctly after failure paths');
    assert.strictEqual(def.range.start.line, 0);
  });

  it('returns null for a symbol imported from a builtin module (no navigable source)', async () => {
    // Regression: `fs` resolves to builtin://fs only AFTER resolveImportPath, so
    // the early builtin:// guard was bypassed and the top-of-module fallback
    // handed back a bogus `builtin://fs` L0 location instead of null.
    const code = `import { open } from 'fs';\nlet fd = open('/etc/hostname', 'r');\n`;
    const p = posOf(code, 'open', 2); // the call site
    const def = await getDefinition(code, '/tmp/def-builtin-import.uc', p.line, p.character);
    assert.strictEqual(def, null, 'builtin-module imports have no source file to navigate to');
  });

  it('resolves an imported variable to its precise declaration line', async () => {
    // Imported non-function exports (let/const) resolve to the variable's own
    // declaration, not the module top — findTopLevelVariables captures them.
    fs.writeFileSync(path.join(tmpDir, 'consts.uc'), 'export function pad() {};\nexport let LIMIT = 42;\n');
    const mainPath = path.join(tmpDir, 'main-const.uc');
    const code = `import { LIMIT } from './consts.uc';\nlet x = LIMIT + 1;\n`;
    fs.writeFileSync(mainPath, code);
    const p = posOf(code, 'LIMIT', 2);
    const def = await getDefinition(code, mainPath, p.line, p.character);
    assert.ok(def, 'expected a cross-file definition');
    assert.ok(def.uri.endsWith('/consts.uc'), `expected definition in consts.uc, got ${def.uri}`);
    assert.strictEqual(def.range.start.line, 1, 'should point to the `export let LIMIT` line, not module top');
  });

  it('resolves an imported const-arrow-function to its precise declaration line', async () => {
    fs.writeFileSync(path.join(tmpDir, 'arrows.uc'), 'export function first() {};\nexport function second() {};\nexport let make = (x) => x * 2;\n');
    const mainPath = path.join(tmpDir, 'main-arrow.uc');
    const code = `import { make } from './arrows.uc';\nlet y = make(3);\n`;
    fs.writeFileSync(mainPath, code);
    const p = posOf(code, 'make', 2);
    const def = await getDefinition(code, mainPath, p.line, p.character);
    assert.ok(def, 'expected a cross-file definition');
    assert.strictEqual(def.range.start.line, 2, 'should point to the `export let make` line');
  });

  it('returns null for a namespace member on a builtin module', async () => {
    // `import * as fs from 'fs'; fs.open()` — namespace-member resolution runs the
    // bare-name resolveImportPath branch; a builtin has no source file → null.
    const code = `import * as fs from 'fs';\nlet fd = fs.open('/etc/hostname', 'r');\n`;
    const p = posOf(code, 'open', 1); // the `open` member of fs
    const def = await getDefinition(code, '/tmp/def-ns-builtin.uc', p.line, p.character);
    assert.strictEqual(def, null, 'a builtin namespace member has no navigable source');
  });

  it('returns null for a require()-d builtin module symbol', async () => {
    // `let mymod = require('fs')` makes `mymod` a MODULE-typed symbol — there is
    // no source declaration to navigate to (getSymbolDefinition returns null).
    const code = `let mymod = require('fs');\nmymod.open('/x', 'r');\n`;
    const p = posOf(code, 'mymod', 2); // the usage on line 1
    const def = await getDefinition(code, '/tmp/def-require-mod.uc', p.line, p.character);
    assert.strictEqual(def, null, 'a require()-d module symbol has no source definition');
  });

  it('falls back to module top for an unlocatable (non-function) default export', async () => {
    // `export default <expr>` has no named declaration to point at, so
    // getImportedSymbolDefinition falls back to the top of the resolved module.
    fs.writeFileSync(path.join(tmpDir, 'defexpr.uc'), 'export default 42;\n');
    const mainPath = path.join(tmpDir, 'main-defexpr.uc');
    const code = `import answer from './defexpr.uc';\nlet x = answer + 1;\n`;
    fs.writeFileSync(mainPath, code);
    const p = posOf(code, 'answer', 2); // the usage
    const def = await getDefinition(code, mainPath, p.line, p.character);
    assert.ok(def, 'expected a fallback definition');
    assert.ok(def.uri.endsWith('/defexpr.uc'), `expected def in defexpr.uc, got ${def.uri}`);
    assert.strictEqual(def.range.start.line, 0, 'should fall back to module top (line 0)');
  });
});

// Go-to-definition across every import-resolution style ucode supports.
// Builds a real module tree on disk and drives the server end-to-end. Covers:
// relative (same-dir / parent / subdir), bare same-directory, dotted
// directory-level, multi-level dotted, renamed + mixed-renamed + collision
// imports, default imports, namespace-member access, and re-export chains
// (1-level, 2-level, and rename-through-chain).
describe('Go to Definition — import resolution (e2e)', function () {
  this.timeout(20000);

  let getDefinition;
  let root;

  // LSP position one char into the identifier located by `anchor`
  // (anchor begins with the identifier, e.g. "util(" or "U.").
  function clickAt(code, anchor) {
    const i = code.indexOf(anchor);
    if (i < 0) throw new Error(`anchor not found: ${anchor}`);
    const pre = code.slice(0, i + 1);
    return { line: (pre.match(/\n/g) || []).length, character: (i + 1) - (pre.lastIndexOf('\n') + 1) };
  }

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getDefinition = server.getDefinition;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-defimp-'));
    const W = (rel, txt) => {
      const f = path.join(root, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, txt);
    };
    W('utils.uc', 'export function util(a) {\n  return a;\n};\nexport function helper(b) {\n  return b;\n};\n');
    W('sibling.uc', 'export function sib() {\n  return 1;\n};\n');
    W('sub/child.uc', 'export function child() {\n  return 2;\n};\n');
    W('sub/deep/leaf.uc', 'export function leaf() {\n  return 3;\n};\n');
    W('chain_a.uc', 'export function chained(x) {\n  return x;\n};\n');
    W('chain_b.uc', "import { chained } from './chain_a.uc';\nexport { chained };\n");
    W('chain_mid.uc', "import { chained } from './chain_b.uc';\nexport { chained };\n");
    W('rename_a.uc', 'export function orig(x) {\n  return x;\n};\n');
    W('rename_b.uc', "import { orig as renamed } from './rename_a.uc';\nexport { renamed };\n");
    W('modA.uc', 'export function dup(a) {\n  return a;\n};\n');
    W('modB.uc', 'export function dup(b) {\n  return b;\n};\n');
    W('defaultmod.uc', 'export default function defFn(x) {\n  return x;\n};\n');
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  // [label, importing-file (relative to root), source code, click anchor, expected "basename Lline"]
  const cases = [
    ['relative same-directory', 'app.uc', "import { util } from './utils.uc';\nutil(1);\n", 'util(', 'utils.uc L0'],
    ['relative, non-first export', 'app.uc', "import { helper } from './utils.uc';\nhelper(1);\n", 'helper(', 'utils.uc L3'],
    ['bare same-directory name', 'app.uc', "import { sib } from 'sibling';\nsib();\n", 'sib(', 'sibling.uc L0'],
    ['relative into subdirectory', 'app.uc', "import { child } from './sub/child.uc';\nchild();\n", 'child(', 'child.uc L0'],
    ['dotted directory-level', 'app.uc', "import { child } from 'sub.child';\nchild();\n", 'child(', 'child.uc L0'],
    ['multi-level dotted', 'app.uc', "import { leaf } from 'sub.deep.leaf';\nleaf();\n", 'leaf(', 'leaf.uc L0'],
    ['relative to parent (../)', 'sub/app2.uc', "import { util } from '../utils.uc';\nutil(1);\n", 'util(', 'utils.uc L0'],
    ['renamed import (as)', 'app.uc', "import { util as u } from './utils.uc';\nu(1);\n", 'u(', 'utils.uc L0'],
    ['mixed renamed — alias', 'app.uc', "import { util as u, helper } from './utils.uc';\nu(1);\nhelper(2);\n", 'u(', 'utils.uc L0'],
    ['mixed renamed — plain', 'app.uc', "import { util as u, helper } from './utils.uc';\nu(1);\nhelper(2);\n", 'helper(', 'utils.uc L3'],
    ['collision, alias A->modA', 'app.uc', "import { dup as dA } from './modA.uc';\nimport { dup as dB } from './modB.uc';\ndA(1);\ndB(2);\n", 'dA(', 'modA.uc L0'],
    ['collision, alias B->modB', 'app.uc', "import { dup as dA } from './modA.uc';\nimport { dup as dB } from './modB.uc';\ndA(1);\ndB(2);\n", 'dB(', 'modB.uc L0'],
    ['re-export chain (1 level)', 'app.uc', "import { chained } from './chain_b.uc';\nchained(1);\n", 'chained(', 'chain_a.uc L0'],
    ['re-export chain (2 levels)', 'app.uc', "import { chained } from './chain_mid.uc';\nchained(1);\n", 'chained(', 'chain_a.uc L0'],
    ['re-export chain + rename', 'app.uc', "import { renamed } from './rename_b.uc';\nrenamed(1);\n", 'renamed(', 'rename_a.uc L0'],
    ['default import', 'app.uc', "import defFn from './defaultmod.uc';\ndefFn(1);\n", 'defFn(', 'defaultmod.uc L0'],
    ['namespace member (first)', 'app.uc', "import * as U from './utils.uc';\nU.util(1);\n", 'util(', 'utils.uc L0'],
    ['namespace member (non-first)', 'app.uc', "import * as U from './utils.uc';\nU.helper(1);\n", 'helper(', 'utils.uc L3'],
  ];

  for (const [label, file, code, anchor, expected] of cases) {
    it(`resolves: ${label}`, async () => {
      const fp = path.join(root, file);
      fs.writeFileSync(fp, code);
      const p = clickAt(code, anchor);
      const def = await getDefinition(code, fp, p.line, p.character);
      assert.ok(def, `expected a definition for "${label}"`);
      const got = `${path.basename(def.uri.replace('file://', ''))} L${def.range.start.line}`;
      assert.strictEqual(got, expected, `"${label}": expected ${expected}, got ${got}`);
    });
  }
});
