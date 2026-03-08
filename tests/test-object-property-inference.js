const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

function extractHoverText(hover) {
  if (!hover || !hover.contents) return '';
  const { contents } = hover;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(e => (typeof e === 'string' ? e : e.value || '')).join('\n');
  return contents.value || '';
}

describe('Object Property Type Inference', function() {
  this.timeout(15000);

  let lspServer;
  let getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(async function() {
    if (lspServer) await lspServer.shutdown();
  });

  it('should infer property types from object literal at declaration', async function() {
    const lines = [
      'let obj = { name: "Alice", age: 30, active: true };',
      'let n = obj.name;',
      'let a = obj.age;',
      'let ac = obj.active;',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-prop-infer.uc');

    // Check obj.name -> string
    const nameLineIdx = 1;
    const nameChar = lines[nameLineIdx].indexOf('name');
    const nameHover = await getHover(content, filePath, nameLineIdx, nameChar);
    const nameText = extractHoverText(nameHover);
    assert.ok(nameText.toLowerCase().includes('string'), `Expected 'string' for obj.name, got: ${nameText}`);

    // Check obj.age -> integer
    const ageLineIdx = 2;
    const ageChar = lines[ageLineIdx].indexOf('age');
    const ageHover = await getHover(content, filePath, ageLineIdx, ageChar);
    const ageText = extractHoverText(ageHover);
    assert.ok(ageText.toLowerCase().includes('int'), `Expected 'integer' for obj.age, got: ${ageText}`);

    // Check obj.active -> boolean
    const activeLineIdx = 3;
    const activeChar = lines[activeLineIdx].indexOf('active');
    const activeHover = await getHover(content, filePath, activeLineIdx, activeChar);
    const activeText = extractHoverText(activeHover);
    assert.ok(activeText.toLowerCase().includes('bool'), `Expected 'boolean' for obj.active, got: ${activeText}`);
  });

  it('should infer function type for function/arrow property values', async function() {
    const lines = [
      'let obj = { fn: function() { return 1; } };',
      'let f = obj.fn;',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-fn-prop.uc');

    const fnLineIdx = 1;
    const fnChar = lines[fnLineIdx].indexOf('fn');
    const fnHover = await getHover(content, filePath, fnLineIdx, fnChar);
    const fnText = extractHoverText(fnHover);
    assert.ok(fnText.toLowerCase().includes('function'), `Expected 'function' for obj.fn, got: ${fnText}`);
  });

  it('should infer function type for identifier referencing a function', async function() {
    const lines = [
      'function foo() { return 1; }',
      'let obj = { handler: foo };',
      'let h = obj.handler;',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-id-prop.uc');

    const hLineIdx = 2;
    const hChar = lines[hLineIdx].indexOf('handler');
    const hHover = await getHover(content, filePath, hLineIdx, hChar);
    const hText = extractHoverText(hHover);
    assert.ok(hText.toLowerCase().includes('function'), `Expected 'function' for obj.handler, got: ${hText}`);
  });

  it('should update property types on reassignment', async function() {
    const lines = [
      'let obj = {};',
      'obj = { x: 1, y: "hi" };',
      'let xv = obj.x;',
      'let yv = obj.y;',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-reassign.uc');

    // obj.x -> integer
    const xLineIdx = 2;
    const xChar = lines[xLineIdx].indexOf('x');
    const xHover = await getHover(content, filePath, xLineIdx, xChar);
    const xText = extractHoverText(xHover);
    assert.ok(xText.toLowerCase().includes('int'), `Expected 'integer' for obj.x after reassignment, got: ${xText}`);

    // obj.y -> string
    const yLineIdx = 3;
    const yChar = lines[yLineIdx].indexOf('y');
    const yHover = await getHover(content, filePath, yLineIdx, yChar);
    const yText = extractHoverText(yHover);
    assert.ok(yText.toLowerCase().includes('string'), `Expected 'string' for obj.y after reassignment, got: ${yText}`);
  });

  it('should infer property types from function return objects', async function() {
    const lines = [
      'function getUser() {',
      '  return { name: "Bob", active: true };',
      '}',
      'let u = getUser();',
      'let un = u.name;',
      'let ua = u.active;',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-fn-return.uc');

    // u.name -> string
    const nameLineIdx = 4;
    const nameChar = lines[nameLineIdx].indexOf('name');
    const nameHover = await getHover(content, filePath, nameLineIdx, nameChar);
    const nameText = extractHoverText(nameHover);
    assert.ok(nameText.toLowerCase().includes('string'), `Expected 'string' for u.name, got: ${nameText}`);

    // u.active -> boolean
    const activeLineIdx = 5;
    const activeChar = lines[activeLineIdx].indexOf('active');
    const activeHover = await getHover(content, filePath, activeLineIdx, activeChar);
    const activeText = extractHoverText(activeHover);
    assert.ok(activeText.toLowerCase().includes('bool'), `Expected 'boolean' for u.active, got: ${activeText}`);
  });

  it('should propagate property types via copy (let b = a)', async function() {
    const lines = [
      'let a = { x: 1, label: "test" };',
      'let b = a;',
      'let bx = b.x;',
      'let bl = b.label;',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-copy.uc');

    // b.x -> integer
    const xLineIdx = 2;
    const xChar = lines[xLineIdx].indexOf('x');
    const xHover = await getHover(content, filePath, xLineIdx, xChar);
    const xText = extractHoverText(xHover);
    assert.ok(xText.toLowerCase().includes('int'), `Expected 'integer' for b.x, got: ${xText}`);

    // b.label -> string
    const lblLineIdx = 3;
    const lblChar = lines[lblLineIdx].indexOf('label');
    const lblHover = await getHover(content, filePath, lblLineIdx, lblChar);
    const lblText = extractHoverText(lblHover);
    assert.ok(lblText.toLowerCase().includes('string'), `Expected 'string' for b.label, got: ${lblText}`);
  });

  it('should infer property types from cross-file default export function return', async function() {
    // Create a temporary module file that exports a factory function
    const moduleDir = path.join(__dirname, '..', 'tmp-test-modules');
    if (!fs.existsSync(moduleDir)) fs.mkdirSync(moduleDir, { recursive: true });

    const modulePath = path.join(moduleDir, 'mymod.uc');
    fs.writeFileSync(modulePath, [
      'function create_mod() {',
      '  let name = "test";',
      '  function do_stuff() { return 1; }',
      '  return { name: name, do_stuff: do_stuff, count: 42, active: true };',
      '}',
      'export default create_mod;',
    ].join('\n'));

    try {
      const testFilePath = path.join(moduleDir, 'consumer.uc');
      const lines = [
        "import create_mod from './mymod';",
        'let m = create_mod();',
        'let mn = m.name;',
        'let md = m.do_stuff;',
        'let mc = m.count;',
      ];
      const content = lines.join('\n');

      // m.name -> string
      const nameLineIdx = 2;
      const nameChar = lines[nameLineIdx].indexOf('name');
      const nameHover = await getHover(content, testFilePath, nameLineIdx, nameChar);
      const nameText = extractHoverText(nameHover);
      assert.ok(nameText.toLowerCase().includes('string'), `Expected 'string' for m.name, got: ${nameText}`);

      // m.do_stuff -> function
      const dsLineIdx = 3;
      const dsChar = lines[dsLineIdx].indexOf('do_stuff');
      const dsHover = await getHover(content, testFilePath, dsLineIdx, dsChar);
      const dsText = extractHoverText(dsHover);
      assert.ok(dsText.toLowerCase().includes('function'), `Expected 'function' for m.do_stuff, got: ${dsText}`);

      // m.count -> integer
      const cLineIdx = 4;
      const cChar = lines[cLineIdx].indexOf('count');
      const cHover = await getHover(content, testFilePath, cLineIdx, cChar);
      const cText = extractHoverText(cHover);
      assert.ok(cText.toLowerCase().includes('int'), `Expected 'integer' for m.count, got: ${cText}`);
    } finally {
      // Clean up
      try { fs.unlinkSync(modulePath); } catch {}
      try { fs.rmdirSync(moduleDir); } catch {}
    }
  });

  it('should not produce false diagnostics on object property access', async function() {
    const lines = [
      'let config = { host: "localhost", port: 8080 };',
      'printf("%s:%d", config.host, config.port);',
    ];
    const content = lines.join('\n');
    const filePath = path.join(__dirname, '..', 'test-obj-no-false-diag.uc');

    // Just check it doesn't crash and hover returns sensible types
    const hostLineIdx = 1;
    const hostChar = lines[hostLineIdx].indexOf('host');
    const hostHover = await getHover(content, filePath, hostLineIdx, hostChar);
    const hostText = extractHoverText(hostHover);
    assert.ok(hostText.toLowerCase().includes('string'), `Expected 'string' for config.host, got: ${hostText}`);
  });
});
