// SERVER-DRIVEN coverage for definition.ts — go-to-definition across local, param,
// object-method, and cross-file-import targets. Assertive: checks the resolved
// Location points at the actual declaration (line), so a wrong target = a real bug.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'def-cov-'));

function posOf(code, needle, occurrence = 1) {
  const lines = code.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    let idx = -1;
    while ((idx = lines[i].indexOf(needle, idx + 1)) !== -1) {
      if (++seen === occurrence) return { line: i, character: idx };
    }
  }
  throw new Error(`needle ${needle} #${occurrence} not found`);
}
const locs = (def) => (Array.isArray(def) ? def : def ? [def] : []);

describe('definition coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer({ workspaceRoot: ws }); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  it('local function call resolves to its declaration line', async () => {
    const code = `function helper(x) {\n  return x + 1;\n}\nlet r = helper(5);\n`;
    const p = posOf(code, 'helper', 2); // call site
    const def = await s.getDefinition(code, path.join(ws, 'd1.uc'), p.line, p.character);
    const l = locs(def);
    assert.ok(l.length >= 1, 'expected a definition');
    assert.strictEqual(l[0].range.start.line, 0, `should point at the function decl (line 0), got ${l[0].range.start.line}`);
  });

  it('local variable use resolves to its let-declaration', async () => {
    const code = `let total = 0;\nlet doubled = total * 2;\nprint(doubled);\n`;
    const p = posOf(code, 'total', 2); // use in line 1
    const def = await s.getDefinition(code, path.join(ws, 'd2.uc'), p.line, p.character);
    const l = locs(def);
    assert.ok(l.length >= 1, 'expected a definition for the variable');
    assert.strictEqual(l[0].range.start.line, 0, `should point at the let-decl (line 0), got ${l[0].range.start.line}`);
  });

  it('parameter use resolves within the function signature', async () => {
    const code = `function f(alpha, beta) {\n  return alpha + beta;\n}\n`;
    const p = posOf(code, 'alpha', 2); // use in body
    const def = await s.getDefinition(code, path.join(ws, 'd3.uc'), p.line, p.character);
    const l = locs(def);
    assert.ok(l.length >= 1, 'expected a definition for the parameter');
    assert.strictEqual(l[0].range.start.line, 0, `param should resolve to the signature (line 0), got ${l[0].range.start.line}`);
  });

  it('cross-file named import resolves into the other file', async () => {
    fs.writeFileSync(path.join(ws, 'lib.uc'), `export function shared(a) {\n  return a;\n}\n`);
    const code = `import { shared } from './lib.uc';\nlet r = shared(1);\n`;
    const p = posOf(code, 'shared', 2); // call site
    const def = await s.getDefinition(code, path.join(ws, 'app.uc'), p.line, p.character);
    const l = locs(def);
    assert.ok(l.length >= 1, 'expected a cross-file definition');
    assert.ok(/lib\.uc$/.test(l[0].uri), `definition should resolve into lib.uc, got ${l[0].uri}`);
  });

  it('returns nothing for an undefined symbol (no crash)', async () => {
    const code = `print(neverDeclared);\n`;
    const p = posOf(code, 'neverDeclared', 1);
    const def = await s.getDefinition(code, path.join(ws, 'd4.uc'), p.line, p.character);
    assert.ok(locs(def).length === 0, 'undefined symbol yields no definition');
  });
});
