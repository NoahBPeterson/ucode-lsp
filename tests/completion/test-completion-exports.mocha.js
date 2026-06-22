// End-to-end tests for member completion of a user module's exports
// (`import * as mod from './lib.uc'; mod.<here>`). Guards the AST-based
// extractExportedSymbols (was regex, which matched `export` in comments/strings
// and produced "x as y" labels for renamed exports).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Completion: user-module exports (e2e)', function () {
  this.timeout(20000);

  let getCompletions;
  let root;

  function labelsOf(result) {
    const items = Array.isArray(result) ? result : (result && result.items) || [];
    return items.map((i) => i.label);
  }

  // Complete `mod.` for the given lib.uc content. ('mod' is not a substring of
  // './lib.uc', so the cursor lands on the member access, not the path string.)
  async function completeModExports(libContent) {
    fs.writeFileSync(path.join(root, 'lib.uc'), libContent);
    const code = "import * as mod from './lib.uc';\nmod.\n";
    const fp = path.join(root, 'app.uc');
    fs.writeFileSync(fp, code);
    const idx = code.indexOf('mod.') + 4; // just after the dot
    const pre = code.slice(0, idx);
    const line = (pre.match(/\n/g) || []).length;
    const character = idx - (pre.lastIndexOf('\n') + 1);
    return labelsOf(await getCompletions(code, fp, line, character));
  }

  before(async function () {
    const server = createLSPTestServer();
    await server.initialize();
    getCompletions = server.getCompletions;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-compexp-'));
  });

  after(function () {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  });

  it('lists exported functions and constants', async () => {
    const labels = await completeModExports("export function foo() {}\nexport const bar = 1;\n");
    assert.ok(labels.includes('foo'), `expected foo, got ${JSON.stringify(labels)}`);
    assert.ok(labels.includes('bar'), `expected bar, got ${JSON.stringify(labels)}`);
  });

  it('lists names from a multi-line export block', async () => {
    const labels = await completeModExports("function a() {}\nfunction b() {}\nexport {\n  a,\n  b\n};\n");
    assert.ok(labels.includes('a') && labels.includes('b'), `expected a,b, got ${JSON.stringify(labels)}`);
  });

  it('uses the exported name for a renamed export (not "x as y")', async () => {
    const labels = await completeModExports("function real() {}\nexport { real as renamed };\n");
    assert.ok(labels.includes('renamed'), `expected 'renamed', got ${JSON.stringify(labels)}`);
    assert.ok(!labels.some((l) => l.includes(' as ')), `should not contain an "as" label, got ${JSON.stringify(labels)}`);
  });

  it('ignores `export` that appears inside a comment', async () => {
    const labels = await completeModExports("// export function ghost() {}\nexport function realfn() {}\n");
    assert.ok(labels.includes('realfn'), `expected realfn, got ${JSON.stringify(labels)}`);
    assert.ok(!labels.includes('ghost'), `ghost (in a comment) should not be completed, got ${JSON.stringify(labels)}`);
  });

  it('ignores `export` that appears inside a string', async () => {
    const labels = await completeModExports("let doc = 'export const fake = 1';\nexport function realfn2() {}\n");
    assert.ok(labels.includes('realfn2'), `expected realfn2, got ${JSON.stringify(labels)}`);
    assert.ok(!labels.includes('fake'), `fake (in a string) should not be completed, got ${JSON.stringify(labels)}`);
  });

  it('re-parses changed exports even when the mtime is unchanged (content-based cache)', async () => {
    // Two versions of lib.uc with the SAME mtime (coarse-resolution filesystem,
    // rapid edit, or a timestamp-restoring tool). The cache must key on content,
    // not mtime, or it serves stale completions.
    const lib = path.join(root, 'lib.uc');
    const fixedTime = new Date('2020-01-01T00:00:00Z');
    const code = "import * as mod from './lib.uc';\nmod.\n";
    const fp = path.join(root, 'app.uc');
    fs.writeFileSync(fp, code);
    const idx = code.indexOf('mod.') + 4;
    const line = (code.slice(0, idx).match(/\n/g) || []).length;
    const character = idx - (code.slice(0, idx).lastIndexOf('\n') + 1);
    const labelsOf = (r) => (Array.isArray(r) ? r : (r && r.items) || []).map((i) => i.label);
    const completeOnly = async () => labelsOf(await getCompletions(code, fp, line, character));

    // v1, mtime pinned to T
    fs.writeFileSync(lib, 'export function aaa() {}\n');
    fs.utimesSync(lib, fixedTime, fixedTime);
    const v1 = await completeOnly();
    assert.ok(v1.includes('aaa'), `v1 should include aaa, got ${JSON.stringify(v1)}`);

    // v2 with the SAME mtime T but different content
    fs.writeFileSync(lib, 'export function bbb() {}\n');
    fs.utimesSync(lib, fixedTime, fixedTime);
    const v2 = await completeOnly();
    assert.ok(v2.includes('bbb'), `expected fresh bbb, got ${JSON.stringify(v2.filter((l) => /^[ab]/.test(l)))}`);
    assert.ok(!v2.includes('aaa'), `aaa should be gone (stale), got ${JSON.stringify(v2.filter((l) => /^[ab]/.test(l)))}`);
  });
});
