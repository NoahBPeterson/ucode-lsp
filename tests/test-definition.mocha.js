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
});
