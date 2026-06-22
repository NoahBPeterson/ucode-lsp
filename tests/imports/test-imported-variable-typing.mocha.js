const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// A NAMED-exported variable (not a function) should carry its type to the
// import site. Previously `import { AllHostInfo }` typed as `unknown` because
// only getNamedExportFunctionReturnInfo (functions) was consulted; a plain
// `let AllHostInfo = {}; export { AllHostInfo }` left it unknown.
describe('Imported named-variable typing', function () {
  this.timeout(15000);

  let lspServer, getHover;
  let tmpDir, libFile, useFile;
  const txt = (h) => (h && h.contents ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '') : '');

  const LIB = `let AllHostInfo = {};
let Counter = 0;
let Names = ['a', 'b'];
let Cfg = { host: 'x', port: 80 };
export function read_hostinfo() { return true; }
export { AllHostInfo, Counter, Names, Cfg };
`;

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-impvar-'));
    libFile = path.join(tmpDir, 'hostinfo.uc');
    useFile = path.join(tmpDir, 'topo.uc');
    fs.writeFileSync(libFile, LIB);
  });

  after(function () {
    try { fs.unlinkSync(libFile); } catch (e) {}
    try { fs.unlinkSync(useFile); } catch (e) {}
    try { fs.rmdirSync(tmpDir); } catch (e) {}
    if (lspServer) lspServer.shutdown();
  });

  // line 0: import { ... } ; lines 1-4 alias each into a local for hover.
  const CONSUMER = `import { AllHostInfo, Counter, Names, Cfg } from './hostinfo.uc';
let a = AllHostInfo;
let c = Counter;
let n = Names;
let g = Cfg;
`;

  async function importedType(name, line, char) {
    return txt(await getHover(CONSUMER, useFile, line, char));
  }

  it('exported object variable imports as `object`', async () => {
    // `AllHostInfo` usage on line 1 ("let a = AllHostInfo;") — char 8
    assert.ok(/object/.test(await importedType('AllHostInfo', 1, 9)),
      'imported object variable should be object');
  });

  it('exported integer variable imports as `integer`', async () => {
    assert.ok(/integer/.test(await importedType('Counter', 2, 9)),
      'imported integer variable should be integer');
  });

  it('exported array variable imports as an array type', async () => {
    assert.ok(/array/.test(await importedType('Names', 3, 9)),
      'imported array variable should be array');
  });

  it('exported object variable carries its property shape (hover on `.host`)', async () => {
    // Cfg.host member hover — Cfg is object with {host,port}.
    const src = `import { Cfg } from './hostinfo.uc';\nlet h = Cfg.host;\n`;
    const text = txt(await getHover(src, useFile, 1, 12)); // 'host' in "let h = Cfg.host;"
    assert.ok(/string/.test(text), `Cfg.host should be string, got: ${text}`);
  });
});
