const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// 0.6.79: when a named-imported function's body returns something we can't
// type-infer (member call, chained call, intermediate var), the symbol used
// to stay typed as `unknown` because getNamedExportFunctionReturnInfo bailed
// to null. Now it returns `{ returnType: UNKNOWN, … }` so the caller can
// still upgrade the symbol's dataType to FUNCTION (hover stops lying about
// the import being a non-callable unknown).
//
// Also covers the simple `let x = "hello"; return x;` identifier case, which
// now resolves through the function's local var inits to STRING.
describe('Imported-function typing robustness', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, 'fixtures', 'import-function-typing');
  const importer = path.join(wsRoot, 'importer.uc');
  let lspServer;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  function firstHoverLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }

  it('a member-call return (`p.read(...)`) still hovers as a function on the import', async function() {
    const code = [
      "'use strict';",
      "import { gen_methodlet } from './gen-unknowable.uc';",
      "let imported_alias = gen_methodlet;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const aliasCol = lines[2].indexOf('imported_alias') + 2;
    const h = firstHoverLine(await lspServer.getHover(code, importer, 2, aliasCol));
    assert.ok(/function/.test(h),
      `expected imported alias to hover as function, got: ${h}`);
  });

  it('a chained-call return (`fs.popen(…).read(…)`) still hovers as a function', async function() {
    const code = [
      "'use strict';",
      "import { gen_chained } from './gen-unknowable.uc';",
      "let chained_alias = gen_chained;",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const aliasCol = lines[2].indexOf('chained_alias') + 2;
    const h = firstHoverLine(await lspServer.getHover(code, importer, 2, aliasCol));
    assert.ok(/function/.test(h),
      `expected chained-return import to hover as function, got: ${h}`);
  });

  it('`let x = "..."; return x;` infers STRING via local var lookup', async function() {
    const code = [
      "'use strict';",
      "import { gen_letident } from './gen-letident.uc';",
      "let letident_result = gen_letident();",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const resCol = lines[2].indexOf('letident_result') + 2;
    const h = firstHoverLine(await lspServer.getHover(code, importer, 2, resCol));
    assert.ok(/string/.test(h),
      `expected gen_letident()'s result to be string, got: ${h}`);
  });

  it('a member-call return still leaves the call result as unknown (no false claim)', async function() {
    // We DO want to mark the import as a function. We do NOT want to invent a
    // return type for it. The call result must stay unknown.
    const code = [
      "'use strict';",
      "import { gen_methodlet } from './gen-unknowable.uc';",
      "let methodlet_result = gen_methodlet();",
      ''
    ].join('\n');
    const lines = code.split('\n');
    const resCol = lines[2].indexOf('methodlet_result') + 2;
    const h = firstHoverLine(await lspServer.getHover(code, importer, 2, resCol));
    assert.ok(/unknown/.test(h),
      `expected call result to remain unknown (no false claim), got: ${h}`);
  });
});
