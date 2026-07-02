// Go-to-definition for IN-FILE globals that have no declared symbol: scalar `global.X = …`
// assignments (jump to the property), bare implicit globals, `@global`-declared names (jump
// to the JSDoc tag), and multi-site globals (all sites returned → editor peek list).
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('Go-to-definition for in-file globals (globalDefSites)', function () {
  this.timeout(20000);
  let s, ws, getDefinition;
  before(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'gdef-'));
    s = createLSPTestServer({ workspaceRoot: ws });
    await s.initialize();
    getDefinition = s.getDefinition;
  });
  after(() => { if (s && s.shutdown) s.shutdown(); try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

  const asArray = (d) => (d == null ? [] : Array.isArray(d) ? d : [d]);

  it('a read of a scalar `global.X = …` global jumps to the assignment property', async () => {
    const code = 'global.COUNTER = 0;\nprint(COUNTER);\n';
    const defs = asArray(await getDefinition(code, path.join(ws, 'a.uc'), 1, 8)); // on COUNTER read
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].range.start.line, 0);
    assert.strictEqual(defs[0].range.start.character, 'global.'.length); // the property span
  });

  it('a read of a global defined inside a function jumps into the function', async () => {
    const code = 'function boot() { global.LEVEL = 2; }\nprint(LEVEL);\n';
    const defs = asArray(await getDefinition(code, path.join(ws, 'b.uc'), 1, 8));
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].range.start.line, 0);
    assert.strictEqual(defs[0].range.start.character, code.indexOf('LEVEL'));
  });

  it('a global assigned in MULTIPLE places returns every site (peek list)', async () => {
    const code = [
      'switch (getenv("C")) {',
      'case "r": global.TINT = 1; break;',
      'default: global.TINT = 0;',
      '}',
      'print(TINT);',
      '',
    ].join('\n');
    const defs = asArray(await getDefinition(code, path.join(ws, 'c.uc'), 4, 7));
    assert.strictEqual(defs.length, 2);
    assert.deepStrictEqual(defs.map(d => d.range.start.line).sort(), [1, 2]);
  });

  it('a @global-declared name jumps to the JSDoc tag (and any assignment sites)', async () => {
    const code = '/** @global HOST_HOOK */\nfunction on() { global.HOST_HOOK = 1; }\nprint(HOST_HOOK);\n';
    const defs = asArray(await getDefinition(code, path.join(ws, 'd.uc'), 2, 8));
    assert.strictEqual(defs.length, 2); // the assignment property + the @global tag
    const lines = defs.map(d => d.range.start.line).sort();
    assert.deepStrictEqual(lines, [0, 1]);
    // the tag site covers exactly the name inside the comment
    const tagDef = defs.find(d => d.range.start.line === 0);
    assert.strictEqual(tagDef.range.start.character, code.indexOf('HOST_HOOK'));
  });

  it('go-to-def works ON the property inside `global.X = …` itself', async () => {
    const code = '/** @global HOOK2 */\nfunction on() { global.HOOK2 = 1; }\n';
    const col = code.split('\n')[1].indexOf('HOOK2') + 1;
    const defs = asArray(await getDefinition(code, path.join(ws, 'e.uc'), 1, col));
    assert.ok(defs.length >= 1, 'expected at least one definition site');
  });

  it('an OBJECT-typed global defined in a function resolves from a read in another function (not line 1 col 0)', async () => {
    // Object globals get a real symbol (declareGlobalObjectBinding) whose forced declaration
    // had a fake node at offset 0 — go-to-def used to land on line 1, column 0.
    const code = 'function boot() { global.CFG = { retries: 3 }; }\nfunction readsShaky() { return CFG; }\n';
    const defs = asArray(await getDefinition(code, path.join(ws, 'g.uc'), 1, 33));
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].range.start.line, 0);
    assert.strictEqual(defs[0].range.start.character, code.indexOf('CFG'), 'must land on the global.CFG property, not offset 0');
  });

  it('a bare implicit global (non-strict `X = …`) resolves from a later read', async () => {
    const code = 'BARE = 42;\nprint(BARE);\n';
    const defs = asArray(await getDefinition(code, path.join(ws, 'f.uc'), 1, 7));
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].range.start.line, 0);
    assert.strictEqual(defs[0].range.start.character, 0);
  });
});
