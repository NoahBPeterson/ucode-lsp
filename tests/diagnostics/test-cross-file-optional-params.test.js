// Cross-file JSDoc optional params: `@param {T} [name]` on an EXPORTED function must
// carry into the importer's arity check, exactly as it does same-file — dropping the
// flag made every cross-file call that omits the param a UC2003 false positive (the
// message even told the author to add the annotation they already had). The `{T=}`,
// `{?T}`, `{T?}` spellings arrive as T|null and were never affected; `[name]` is the
// one that needs ParamInfo.optional (fileResolver.extractFunctionParameters).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, dir, n = 0;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xopt-'));
  fs.writeFileSync(path.join(dir, 'helper.uc'),
    '/**\n * @param {string} key\n * @param {string} [ctx]\n * @returns {string?}\n */\n' +
    "export function tx(key, ctx) {\n\treturn key ? '' : null;\n}\n" +
    '/**\n * @param {string} key\n * @param {string} required_second\n */\n' +
    'export function tboth(key, required_second) {\n\treturn key + required_second;\n}\n');
});
afterAll(() => { try { server.shutdown(); } catch {}; fs.rmSync(dir, { recursive: true, force: true }); });

const uc2003s = (d) => (d || []).filter((x) => String(x.code) === 'UC2003').map((x) => x.message);

test('omitting a bracket-optional param of an imported function is clean', async () => {
  const code = "import { tx } from './helper.uc';\nlet r = tx('k');\nprint(r);\n";
  expect(uc2003s(await server.getDiagnostics(code, path.join(dir, `m${n++}.uc`)))).toEqual([]);
});

test('omitting a REQUIRED param of an imported function still warns', async () => {
  const code = "import { tboth } from './helper.uc';\nlet r = tboth('k');\nprint(r);\n";
  const msgs = uc2003s(await server.getDiagnostics(code, path.join(dir, `m${n++}.uc`)));
  expect(msgs.length).toBe(1);
  expect(msgs[0]).toContain("'required_second'");
});

test('the optional param still accepts an explicit argument', async () => {
  const code = "import { tx } from './helper.uc';\nlet r = tx('k', 'website');\nprint(r);\n";
  expect(uc2003s(await server.getDiagnostics(code, path.join(dir, `m${n++}.uc`)))).toEqual([]);
});
