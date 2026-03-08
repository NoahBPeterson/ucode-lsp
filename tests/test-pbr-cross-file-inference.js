const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

function extractHoverText(hover) {
  if (!hover || !hover.contents) return '';
  const { contents } = hover;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(e => (typeof e === 'string' ? e : e.value || '')).join('\n');
  return contents.value || '';
}

// The consumer file must live in the same directory as the real pbr modules
// so that bare imports like 'config' resolve to config.uc in that directory.
const PBR_DIR = path.join(__dirname, '..', 'pbr', 'files', 'lib', 'pbr');
const TEST_FILE = path.join(PBR_DIR, '_test_cross_file_consumer.uc');

describe('PBR Cross-File Property Inference', function() {
  this.timeout(30000);

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

  // ── pkg.uc: object default export ────────────────────────────────

  describe('pkg.uc (object default export)', function() {
    const lines = [
      "import _pkg_mod from 'pkg';",
      'let pkg = _pkg_mod.pkg;',
      'let sym = _pkg_mod.sym;',
      'let get_text = _pkg_mod.get_text;',
    ];
    const content = lines.join('\n');

    it('should type _pkg_mod.pkg as object', async function() {
      const lineIdx = 1;
      const charIdx = lines[lineIdx].indexOf('.pkg') + 1; // hover on "pkg" property
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for _pkg_mod.pkg, got: ${text}`);
    });

    it('should type _pkg_mod.get_text as function', async function() {
      const lineIdx = 3;
      const charIdx = lines[lineIdx].indexOf('get_text');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for _pkg_mod.get_text, got: ${text}`);
    });
  });

  // ── config.uc: factory function default export ───────────────────

  describe('config.uc (factory function default export)', function() {
    const lines = [
      "import create_config from 'config';",
      'let config = create_config(null, null, null);',
      'let cfg = config.cfg;',
      'let uc = config.uci_ctx;',
      'let ub = config.ubus_call;',
      'let ld = config.load;',
      'let po = config.parse_options;',
    ];
    const content = lines.join('\n');

    it('should type create_config as function (not object)', async function() {
      const lineIdx = 0;
      const charIdx = lines[lineIdx].indexOf('create_config');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for create_config import, got: ${text}`);
    });

    it('should type config (return value) as object', async function() {
      const lineIdx = 1;
      const charIdx = lines[lineIdx].indexOf('config');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for config variable, got: ${text}`);
    });

    it('should type config.cfg as object', async function() {
      const lineIdx = 2;
      const charIdx = lines[lineIdx].indexOf('cfg');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for config.cfg, got: ${text}`);
    });

    it('should type config.uci_ctx as function', async function() {
      const lineIdx = 3;
      const charIdx = lines[lineIdx].indexOf('uci_ctx');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for config.uci_ctx, got: ${text}`);
    });

    it('should type config.load as function', async function() {
      const lineIdx = 5;
      const charIdx = lines[lineIdx].indexOf('load');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for config.load, got: ${text}`);
    });

    it('should type config.parse_options as function', async function() {
      const lineIdx = 6;
      const charIdx = lines[lineIdx].indexOf('parse_options');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for config.parse_options, got: ${text}`);
    });
  });

  // ── sys.uc: factory function default export ──────────────────────

  describe('sys.uc (factory function default export)', function() {
    const lines = [
      "import create_sys from 'sys';",
      "import _pkg_mod from 'pkg';",
      'let pkg = _pkg_mod.pkg;',
      'let sh = create_sys(null, pkg);',
      'let ex = sh.exec;',
      'let rn = sh.run;',
      'let qt = sh.quote;',
    ];
    const content = lines.join('\n');

    it('should type create_sys as function', async function() {
      const lineIdx = 0;
      const charIdx = lines[lineIdx].indexOf('create_sys');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for create_sys, got: ${text}`);
    });

    it('should type sh.exec as function', async function() {
      const lineIdx = 4;
      const charIdx = lines[lineIdx].indexOf('exec');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for sh.exec, got: ${text}`);
    });

    it('should type sh.run as function', async function() {
      const lineIdx = 5;
      const charIdx = lines[lineIdx].indexOf('run');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for sh.run, got: ${text}`);
    });
  });

  // ── validators.uc: factory function default export ───────────────

  describe('validators.uc (factory function default export)', function() {
    const lines = [
      "import create_validators from 'validators';",
      'let V = create_validators(null);',
      'let i4 = V.is_ipv4;',
      'let i6 = V.is_ipv6;',
      'let sc = V.str_contains;',
    ];
    const content = lines.join('\n');

    it('should type create_validators as function', async function() {
      const lineIdx = 0;
      const charIdx = lines[lineIdx].indexOf('create_validators');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for create_validators, got: ${text}`);
    });

    it('should type V.is_ipv4 as function', async function() {
      const lineIdx = 2;
      const charIdx = lines[lineIdx].indexOf('is_ipv4');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for V.is_ipv4, got: ${text}`);
    });
  });

  // ── platform.uc: factory function default export ─────────────────

  describe('platform.uc (factory function default export)', function() {
    const lines = [
      "import create_platform from 'platform';",
      'let platform = create_platform(null, null, null, null);',
      'let env = platform.env;',
      'let dt = platform.detect;',
    ];
    const content = lines.join('\n');

    it('should type platform.env as object', async function() {
      const lineIdx = 2;
      const charIdx = lines[lineIdx].indexOf('env');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for platform.env, got: ${text}`);
    });

    it('should type platform.detect as function', async function() {
      const lineIdx = 3;
      const charIdx = lines[lineIdx].indexOf('detect');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for platform.detect, got: ${text}`);
    });
  });

  // ── chained usage: factory results used as args to another factory ─

  describe('chained factory calls (config -> properties)', function() {
    const lines = [
      "import create_config from 'config';",
      'let config = create_config(null, null, null);',
      'let ctx = config.uci_ctx;',
      'config.load(null);',
    ];
    const content = lines.join('\n');

    it('should not show config as unknown', async function() {
      const lineIdx = 1;
      const charIdx = lines[lineIdx].indexOf('config');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(!text.toLowerCase().includes('unknown'),
        `config should not be 'unknown', got: ${text}`);
    });
  });

  // ── nested scope: factory call results inside a function body ────

  describe('nested scope (factory calls inside function body)', function() {
    const lines = [
      "import create_config from 'config';",
      "import create_sys from 'sys';",
      "import _pkg_mod from 'pkg';",
      'let pkg = _pkg_mod.pkg;',
      'function create_pbr() {',
      '  let config = create_config(null, null, pkg);',
      '  let sh = create_sys(null, pkg);',
      '  let cfg = config.cfg;',
      '  let uc = config.uci_ctx;',
      '  let ex = sh.exec;',
      '  let rn = sh.run;',
      '}',
    ];
    const content = lines.join('\n');

    it('should type config.cfg as object inside function', async function() {
      const lineIdx = 7;
      const charIdx = lines[lineIdx].indexOf('cfg');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for config.cfg inside fn, got: ${text}`);
    });

    it('should type config.uci_ctx as function inside function', async function() {
      const lineIdx = 8;
      const charIdx = lines[lineIdx].indexOf('uci_ctx');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for config.uci_ctx inside fn, got: ${text}`);
    });

    it('should type sh.exec as function inside function', async function() {
      const lineIdx = 9;
      const charIdx = lines[lineIdx].indexOf('exec');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for sh.exec inside fn, got: ${text}`);
    });

    it('should type sh.run as function inside function', async function() {
      const lineIdx = 10;
      const charIdx = lines[lineIdx].indexOf('run');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for sh.run inside fn, got: ${text}`);
    });
  });

  // ── pbr.uc itself: the full module as default export ─────────────

  describe('pbr.uc (factory function default export)', function() {
    const lines = [
      "import create_pbr from './pbr';",
      'let pbr = create_pbr(null, null, null);',
      'let ss = pbr.start_service;',
      'let st = pbr.stop_service;',
      'let ne = pbr.netifd;',
      'let pk = pbr.pkg;',
    ];
    const content = lines.join('\n');

    it('should type create_pbr as function', async function() {
      const lineIdx = 0;
      const charIdx = lines[lineIdx].indexOf('create_pbr');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for create_pbr, got: ${text}`);
    });

    it('should type pbr.start_service as function', async function() {
      const lineIdx = 2;
      const charIdx = lines[lineIdx].indexOf('start_service');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for pbr.start_service, got: ${text}`);
    });

    it('should type pbr.stop_service as function', async function() {
      const lineIdx = 3;
      const charIdx = lines[lineIdx].indexOf('stop_service');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for pbr.stop_service, got: ${text}`);
    });
  });
});
