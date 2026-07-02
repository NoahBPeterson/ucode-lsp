const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// `loadfile("./b.uc")()` runs b.uc's top-level in the shared global scope, leaking its
// `global.X = { … }`. The object's SHAPE now crosses that boundary too: bare X, its
// literal members, its method return types, and even a property added in the importing
// file all resolve — previously every member read was `unknown` (name-only injection).
describe('Cross-file global object property inference (loadfile-injected)', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, '..', 'fixtures', 'xfglobal');
  // Virtual importer (not on disk) so the shared server can't race stale content.
  const file = path.join(wsRoot, 'consumer.uc');
  let lspServer;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() { if (lspServer) lspServer.shutdown(); });

  async function hoverType(code, lineIdx, name) {
    const start = code.split('\n')[lineIdx].indexOf(name);
    for (let col = start; col <= start + name.length; col++) {
      const h = await lspServer.getHover(code, file, lineIdx, col);
      const line = (typeof h?.contents === 'string' ? h.contents : h?.contents?.value || '').split('\n')[0];
      if (line) return line;
    }
    return '';
  }

  it("a literal member of the injected global resolves (string / integer)", async function() {
    const code = [
      "'use strict';",
      "loadfile('./injector.uc')();",
      'let dr = uhttpd.docroot;',
      'let pt = uhttpd.port;',
      ''
    ].join('\n');
    assert.ok(/string/.test(await hoverType(code, 2, 'dr')), 'docroot should be string');
    assert.ok(/integer/.test(await hoverType(code, 3, 'pt')), 'port should be integer');
  });

  it("the bare injected global reads as object (not unknown)", async function() {
    const code = [
      "'use strict';",
      "loadfile('./injector.uc')();",
      'let base = uhttpd;',
      ''
    ].join('\n');
    assert.ok(/object/.test(await hoverType(code, 2, 'base')), 'bare uhttpd should be object');
  });

  it("a method on the injected global resolves its return type", async function() {
    const code = [
      "'use strict';",
      "loadfile('./injector.uc')();",
      'let sent = uhttpd.send("hi");',
      ''
    ].join('\n');
    assert.ok(/integer/.test(await hoverType(code, 2, 'sent')), 'uhttpd.send() should be integer');
  });

  it("a property added in the importing file types from its assignment", async function() {
    const code = [
      "'use strict';",
      "loadfile('./injector.uc')();",
      'uhttpd._body = "hello";',
      'let bv = uhttpd._body;',
      ''
    ].join('\n');
    assert.ok(/string/.test(await hoverType(code, 3, 'bv')), 'added uhttpd._body should be string');
  });
});
