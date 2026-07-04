// UC7003 "add @param" hint + its quick-fix must fire for OBJECT-LITERAL PROPERTY functions
// (the RPC-handler idiom `export default { method: function(args, ctx){…} }`), not just
// top-level declarations and `x = function(){}` assignments. Previously the diagnostic never
// fired on a property function (its display name wasn't derived from the property key), so the
// quick-fix — which already supported Property values — was never offered.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-prop-')); });
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const fp = () => path.join(dir, `t${n++}.uc`);
function applyEdits(code, edits) {
  const lines = code.split('\n');
  const off = (p) => { let o = 0; for (let i = 0; i < p.line; i++) o += lines[i].length + 1; return o + p.character; };
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = code;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
}
async function u7003(code) {
  const file = fp();
  const diags = (await server.getDiagnostics(code, file)) || [];
  const d = diags.find((x) => x.code === 'UC7003');
  return { d, file, code, diags };
}

const RPC = "'use strict';\nexport default {\n  load_locales: function(args, ctx) { return args; }\n};\n";

test('UC7003 fires on an object-property function under strict mode', async () => {
  const { d } = await u7003(RPC);
  expect(d).toBeTruthy();
  expect(d.message).toContain('load_locales');
  expect(d.message).toContain('args, ctx');
});
test('the add-JSDoc quick-fix is offered and inserts @param for each unknown param', async () => {
  const { d, file, code } = await u7003(RPC);
  const acts = (await server.getCodeActions(file, [d], d.range.start.line, d.range.start.character)) || [];
  const act = acts.find((a) => /JSDoc|@param/i.test(a.title));
  expect(act).toBeTruthy();
  const out = applyEdits(code, act.edit.changes[`file://${file}`]);
  expect(out).toContain('@param');
  expect(out).toContain('args');
  expect(out).toContain('ctx');
});
test('adding a JSDoc block clears the diagnostic', async () => {
  const withDoc = "'use strict';\nexport default {\n  /** @param {object} args\n   *  @param {object} ctx */\n  load_locales: function(args, ctx) { return args; }\n};\n";
  const { d } = await u7003(withDoc);
  expect(d).toBeUndefined();
});
test('non-strict mode does not fire (consistent with function declarations)', async () => {
  const { d } = await u7003("export default {\n  load_locales: function(args, ctx) { return args; }\n};\n");
  expect(d).toBeUndefined();
});
test('a property with a non-function value is unaffected', async () => {
  const { diags } = await u7003("'use strict';\nexport default {\n  name: 'x',\n  count: 5\n};\n");
  expect(diags.some((x) => x.code === 'UC7003')).toBe(false);
});
