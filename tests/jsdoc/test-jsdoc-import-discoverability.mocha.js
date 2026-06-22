const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Three real-world JSDoc/import ergonomics features:
//  1. `@param {` completion offers `import('./x.uc').<prop>` for object modules.
//  2. UC7003 ("add @param") fires on method-style function expressions.
//  3. UC7004 ("property does not exist") on a closed import-object shape.
describe('JSDoc import discoverability + closed-shape diagnostics', function () {
  this.timeout(15000);

  let lspServer, getCompletions, getDiagnostics, getHover;
  let tmpDir, constsFile, factoryFile, consumerFile;
  const itemList = (res) => (Array.isArray(res) ? res : (res && res.items) || []);
  const codes = (ds, c) => ds.filter(d => d.code === c);

  // Inline default-object export with a post-literal addition (service_name).
  const CONSTS = `'use strict';
const pkg = { name: 'x', rt_tables_file: '/etc/foo' };
pkg.service_name = pkg.name;
const sym = { ok: 1 };
function get_text(c) { return c; }
export default { pkg, sym, get_text };
`;
  // Factory default export (function) — bare import is the right form.
  const FACTORY = `function make(dep) {
\tfunction run(cmd) { return system(cmd); }
\treturn { run };
}
export default make;
`;

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getCompletions = lspServer.getCompletions;
    getDiagnostics = lspServer.getDiagnostics;
    getHover = lspServer.getHover;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-disc-'));
    constsFile = path.join(tmpDir, 'consts.uc');
    factoryFile = path.join(tmpDir, 'factory.uc');
    consumerFile = path.join(tmpDir, 'consumer.uc');
    fs.writeFileSync(constsFile, CONSTS);
    fs.writeFileSync(factoryFile, FACTORY);
  });

  after(function () {
    try { fs.unlinkSync(constsFile); } catch (e) {}
    try { fs.unlinkSync(factoryFile); } catch (e) {}
    try { fs.unlinkSync(consumerFile); } catch (e) {}
    try { fs.rmdirSync(tmpDir); } catch (e) {}
    if (lspServer) lspServer.shutdown();
  });

  // --- 1. .prop import completions ---

  it('@param { offers object-module .prop forms; factory stays bare', async () => {
    const src = `/** @param {} x */\nfunction f(x) { return x; }\n`;
    const labels = itemList(await getCompletions(src, consumerFile, 0, 12)).map(i => i.label);
    // consts.uc default export is an object → offer bare + each property.
    assert.ok(labels.includes("import('./consts.uc')"), `bare consts missing: ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("import('./consts.uc').pkg"), `.pkg missing: ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("import('./consts.uc').sym"), `.sym missing`);
    assert.ok(labels.includes("import('./consts.uc').get_text"), `.get_text missing`);
    // factory.uc default export is a function → bare only, no .prop.
    assert.ok(labels.includes("import('./factory.uc')"), `bare factory missing`);
    assert.ok(!labels.some(l => l.startsWith("import('./factory.uc').")), `factory should have no .prop forms: ${JSON.stringify(labels.filter(l=>l.includes('factory')))}`);
  });

  // --- 2. UC7003 on function expressions ---

  it('UC7003 fires on a member-assigned function expression, not on a callback', async () => {
    const src = `'use strict';\nlet obj = {};\nobj.method = function(target, reg) {\n\treturn target + reg;\n};\nlet z = map([1, 2], (v) => v + 1);\n`;
    const ds = codes(await getDiagnostics(src, consumerFile), 'UC7003');
    assert.strictEqual(ds.length, 1, `expected exactly 1 UC7003, got: ${JSON.stringify(ds.map(d => d.message))}`);
    assert.ok(/obj\.method/.test(ds[0].message), `message should name obj.method, got: ${ds[0].message}`);
  });

  // --- 3. UC7004 missing member on a closed shape ---

  it('UC7004 flags a member absent from a closed object-import shape', async () => {
    const src = `/** @param {import('./consts.uc')} p */\nfunction f(p) {\n\tlet a = p.rt_tables_file;\n\tlet b = p.pkg;\n\treturn a + b;\n}\n`;
    const ds = codes(await getDiagnostics(src, consumerFile), 'UC7004');
    assert.strictEqual(ds.length, 1, `expected 1 UC7004 (rt_tables_file), got: ${JSON.stringify(ds.map(d => d.message))}`);
    assert.ok(/rt_tables_file/.test(ds[0].message), `should name rt_tables_file: ${ds[0].message}`);
    assert.ok(/pkg, sym, get_text/.test(ds[0].message), `should list available members: ${ds[0].message}`);
  });

  // --- 4. JSDoc on a member-assigned function expression propagates ---

  it('JSDoc above `obj.method = function(...)` types the params AND suppresses UC7003', async () => {
    const src = `'use strict';\nlet obj = {};\n/**\n * @param {object} reg\n */\nobj.init = function(reg) {\n\tlet x = reg;\n\treturn x;\n};\n`;
    // `reg` at line 6 (0-indexed), inside "\tlet x = reg;"
    const hover = await getHover(src, consumerFile, 6, 9);
    const text = typeof hover.contents === 'string' ? hover.contents : (hover.contents?.value || '');
    assert.ok(/object/.test(text), `reg should be typed object from JSDoc, got: ${text}`);
    const ds = codes(await getDiagnostics(src, consumerFile), 'UC7003');
    assert.strictEqual(ds.length, 0, `JSDoc should suppress UC7003, got: ${JSON.stringify(ds.map(d => d.message))}`);
  });

  it('UC7004 does NOT fire on the .prop form (nested shape not closed → no post-literal false positive)', async () => {
    // `.pkg` resolves the inner const, which gains `service_name` after the
    // literal — must not be flagged. rt_tables_file is a real member.
    const src = `/** @param {import('./consts.uc').pkg} p */\nfunction f(p) {\n\tlet a = p.rt_tables_file;\n\tlet b = p.service_name;\n\treturn a + b;\n}\n`;
    const ds = codes(await getDiagnostics(src, consumerFile), 'UC7004');
    assert.strictEqual(ds.length, 0, `expected no UC7004, got: ${JSON.stringify(ds.map(d => d.message))}`);
  });
});
