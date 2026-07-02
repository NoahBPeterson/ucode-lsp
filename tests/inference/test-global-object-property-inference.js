const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// `global.X = { … }` used to make X a name-only global property: bare `X`, its literal
// members, and later `X.prop = …` writes all resolved to `unknown` because there was no
// first-class symbol to type or attach property-flow tracking to (in contrast to a local
// `let obj = { … }`, which works). The fix declares X as a real global object symbol
// carrying the literal's shape.
describe('Global object property inference (global.X = { … })', function() {
  this.timeout(15000);

  let lspServer;
  // Distinct virtual file per assertion: the shared test server keeps the first content
  // opened for a URI, so reusing one path would race against stale text.
  const fileFor = (n) => path.join(process.cwd(), `tests/__gop_${n}.uc`);

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
  });
  after(async function() {
    if (lspServer) await lspServer.shutdown();
  });

  // Hover is positionally flaky; scan columns across the name, take first non-empty.
  async function hoverType(code, file, lineIdx, name) {
    const start = code.split('\n')[lineIdx].indexOf(name);
    for (let col = start; col <= start + name.length; col++) {
      const h = await lspServer.getHover(code, file, lineIdx, col);
      const line = (typeof h?.contents === 'string' ? h.contents : h?.contents?.value || '').split('\n')[0];
      if (line) return line;
    }
    return '';
  }

  it("a property added after the literal (X.prop = …) types from its assignment", async function() {
    const code = [
      "'use strict';",
      'global.uhttpd = { docroot: "/www" };',
      'uhttpd._body = "hello";',
      'let bodyval = uhttpd._body;',
      ''
    ].join('\n');
    const t = await hoverType(code, fileFor('added'), 3, 'bodyval');
    assert.ok(/string/.test(t), `uhttpd._body should be string, got: ${JSON.stringify(t)}`);
  });

  it("a property present in the literal resolves its type", async function() {
    const code = [
      "'use strict';",
      'global.uhttpd = { docroot: "/www", port: 80 };',
      'let dr = uhttpd.docroot;',
      'let pt = uhttpd.port;',
      ''
    ].join('\n');
    const file = fileFor('literal');
    assert.ok(/string/.test(await hoverType(code, file, 2, 'dr')), 'docroot should be string');
    assert.ok(/integer/.test(await hoverType(code, file, 3, 'pt')), 'port should be integer');
  });

  it("the bare global object reads as object (not unknown)", async function() {
    const code = [
      "'use strict';",
      'global.cfg = { a: 1 };',
      'let base = cfg;',
      ''
    ].join('\n');
    const t = await hoverType(code, fileFor('bare'), 2, 'base');
    assert.ok(/object/.test(t), `bare global object should be object, got: ${JSON.stringify(t)}`);
  });

  it("a method on the global object resolves its return type", async function() {
    const code = [
      "'use strict';",
      'global.api = { ping: function() { return 1; } };',
      'let r = api.ping();',
      ''
    ].join('\n');
    const t = await hoverType(code, fileFor('method'), 2, 'r');
    assert.ok(/integer/.test(t), `api.ping() should be integer, got: ${JSON.stringify(t)}`);
  });
});
