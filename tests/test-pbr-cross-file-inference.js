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
  let getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
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

    it('should type config.uci_ctx() call result as uci.cursor (not function)', async function() {
      const callLines = [
        "import create_config from 'config';",
        'let config = create_config(null, null, null);',
        "let ctx = config.uci_ctx('test');",
      ];
      const callContent = callLines.join('\n');
      const lineIdx = 2;
      const charIdx = callLines[lineIdx].indexOf('ctx');
      const hover = await getHover(callContent, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(!text.toLowerCase().includes('function'),
        `ctx should not be 'function', should be cursor; got: ${text}`);
      assert.ok(!text.toLowerCase().includes('unknown'),
        `ctx should not be 'unknown', should be cursor; got: ${text}`);
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

  // ── sys.uc: function property return types ─────────────────────────

  describe('sys.uc (function property return types)', function() {
    const lines = [
      "import create_sys from 'sys';",
      "import _pkg_mod from 'pkg';",
      'let pkg = _pkg_mod.pkg;',
      'let sh = create_sys(null, pkg);',
      "let result = sh.exec('ls');",
      "let rc = sh.run('ls');",
      "let q = sh.quote('hello');",
    ];
    const content = lines.join('\n');

    it('should type sh.exec() call result as string (not function)', async function() {
      const lineIdx = 4;
      const charIdx = lines[lineIdx].indexOf('result');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' for sh.exec() result, got: ${text}`);
    });

    it('should type sh.run() call result as integer', async function() {
      const lineIdx = 5;
      const charIdx = lines[lineIdx].indexOf('rc');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('integer'),
        `Expected 'integer' for sh.run() result, got: ${text}`);
    });

    it('should type sh.quote() call result as string', async function() {
      const lineIdx = 6;
      const charIdx = lines[lineIdx].indexOf('q =') ; // hover on 'q'
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' for sh.quote() result, got: ${text}`);
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

  // ── double-nested scope: factory call results used two levels deep ──

  describe('double-nested scope (factory results in inner function)', function() {
    const lines = [
      "import create_config from 'config';",
      "import create_sys from 'sys';",
      "import _pkg_mod from 'pkg';",
      'let pkg = _pkg_mod.pkg;',
      'function create_pbr() {',
      '  let config = create_config(null, null, pkg);',
      '  let sh = create_sys(null, pkg);',
      '  function inner_check() {',
      '    let cfg = config.cfg;',
      '    let uc = config.uci_ctx;',
      '    let ex = sh.exec;',
      '    let rn = sh.run;',
      '  }',
      '}',
    ];
    const content = lines.join('\n');

    it('should type config.cfg as object in double-nested function', async function() {
      const lineIdx = 8;
      const charIdx = lines[lineIdx].indexOf('cfg');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for config.cfg in inner fn, got: ${text}`);
    });

    it('should type config.uci_ctx as function in double-nested function', async function() {
      const lineIdx = 9;
      const charIdx = lines[lineIdx].indexOf('uci_ctx');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for config.uci_ctx in inner fn, got: ${text}`);
    });

    it('should type sh.exec as function in double-nested function', async function() {
      const lineIdx = 10;
      const charIdx = lines[lineIdx].indexOf('exec');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for sh.exec in inner fn, got: ${text}`);
    });

    it('should type sh.run as function in double-nested function', async function() {
      const lineIdx = 11;
      const charIdx = lines[lineIdx].indexOf('run');
      const hover = await getHover(content, TEST_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for sh.run in inner fn, got: ${text}`);
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

  // ── real pbr.uc file: verify types inside deeply nested functions ──

  describe('real pbr.uc file analysis', function() {
    const fs = require('fs');
    const PBR_FILE = path.join(PBR_DIR, 'pbr.uc');
    const pbrContent = fs.readFileSync(PBR_FILE, 'utf-8');
    const pbrLines = pbrContent.split('\n');

    it('should type config as object (not unknown) at line 152', async function() {
      // line 152: let ctx_dhcp = config.uci_ctx('dhcp'); // config should not be unknown
      const lineIdx = 151; // 0-indexed
      const charIdx = pbrLines[lineIdx].indexOf('config');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(!text.toLowerCase().includes('unknown'),
        `config should not be 'unknown' at line 152, got: ${text}`);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for config at line 152, got: ${text}`);
    });

    it('should provide hover for config.uci_ctx at line 152', async function() {
      const lineIdx = 151;
      const charIdx = pbrLines[lineIdx].indexOf('uci_ctx');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.length > 0,
        `Expected hover for config.uci_ctx at line 152, got empty`);
      assert.ok(text.toLowerCase().includes('function'),
        `Expected 'function' for config.uci_ctx, got: ${text}`);
    });

    it('should type config.cfg as object at line 36', async function() {
      // line 36: let cfg = config.cfg;
      const lineIdx = 35;
      const charIdx = pbrLines[lineIdx].indexOf('.cfg') + 1;
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('object'),
        `Expected 'object' for config.cfg at line 36, got: ${text}`);
    });

    it('should type ctx_dhcp as object/cursor (not function) at line 152', async function() {
      // line 152: let ctx_dhcp = config.uci_ctx('dhcp');
      const lineIdx = 151;
      const charIdx = pbrLines[lineIdx].indexOf('ctx_dhcp');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      // ctx_dhcp should be a UCI cursor object, not 'function' or 'unknown'
      assert.ok(!text.toLowerCase().includes('unknown'),
        `ctx_dhcp should not be 'unknown', got: ${text}`);
    });

    it('should provide hover for ctx_dhcp.get at line 162', async function() {
      // line 162: let dhcp_option = ctx_dhcp.get('dhcp', iface, 'dhcp_option');
      const lineIdx = 161;
      const charIdx = pbrLines[lineIdx].indexOf('.get') + 1;
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.length > 0,
        `Expected hover for ctx_dhcp.get, got empty`);
    });

    it('should show built-in note in hover for ctx_dhcp.get', async function() {
      const lineIdx = 161;
      const charIdx = pbrLines[lineIdx].indexOf('.get') + 1;
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.includes('Built-in C method'),
        `Expected built-in note in hover for ctx_dhcp.get, got: ${text}`);
    });

    it('should type dhcp_option from cursor.get as string | array | null at line 162', async function() {
      const lineIdx = 161;
      const charIdx = pbrLines[lineIdx].indexOf('dhcp_option');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(!text.toLowerCase().includes('unknown'),
        `dhcp_option should not be 'unknown', got: ${text}`);
    });

    it('should narrow dhcp_option to array after type guard at line 167', async function() {
      // line 163: if (type(dhcp_option) != 'array') return;
      // line 167: for (let opt in dhcp_option) {  -- should be array here
      const lineIdx = 166;
      const charIdx = pbrLines[lineIdx].indexOf('dhcp_option');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('array'),
        `Expected 'array' for dhcp_option after type guard, got: ${text}`);
    });

    it('should type ipaddr as string | array at line 164 (|| only eliminates null)', async function() {
      // line 164: let ipaddr = ctx_net.get('network', iface, 'ipaddr') || '';
      // get() returns string | string[] | null.
      // || '' eliminates null (falsy), but arrays are truthy so string[] survives.
      // Result: string | array
      const lineIdx = 163;
      const charIdx = pbrLines[lineIdx].indexOf('ipaddr');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' in ipaddr type, got: ${text}`);
      assert.ok(text.toLowerCase().includes('array'),
        `Expected 'array' in ipaddr type (arrays are truthy, survive ||), got: ${text}`);
      assert.ok(!text.toLowerCase().includes('null'),
        `ipaddr should not include null (|| '' eliminates it), got: ${text}`);
    });

    it('should not show false positive UC2007 on hex() at line 879', async function() {
      // line 879: let iface_mark = sprintf('0x%06x', hex(cfg.uplink_mark));
      // hex() returns integer, so %x should be valid
      const lineIdx = 878;
      const charIdx = pbrLines[lineIdx].indexOf('hex');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('integer'),
        `Expected 'integer' for hex() return type, got: ${text}`);
    });

    it('should type sh.exec() result as string (not function) at line 742', async function() {
      // line 742: let route_check = sh.exec(pkg.ip_full + ...);
      const lineIdx = 741;
      const charIdx = pbrLines[lineIdx].indexOf('route_check');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' for sh.exec() result at line 742, got: ${text}`);
      assert.ok(!text.toLowerCase().includes('function'),
        `sh.exec() result should not be 'function', got: ${text}`);
    });

    it('should type dev6_out from sh.exec() as string at line 752', async function() {
      // line 752: let dev6_out = sh.exec(...);
      const lineIdx = 751;
      const charIdx = pbrLines[lineIdx].indexOf('dev6_out');
      const hover = await getHover(pbrContent, PBR_FILE, lineIdx, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' for dev6_out at line 752, got: ${text}`);
    });

    it('should not have false positive diagnostic on index(route_check) at line 743', async function() {
      // line 743: if (index(route_check, ...) >= 0) — route_check is string, not function
      const diagnostics = await getDiagnostics(pbrContent, PBR_FILE);
      const line743Diags = diagnostics.filter(d =>
        d.range.start.line === 742 && d.message && d.message.includes('index')
      );
      assert.strictEqual(line743Diags.length, 0,
        `Should not have false positive on index() at line 743, got: ${line743Diags.map(d => d.message).join('; ')}`);
    });

    it('should not have false positive diagnostic on trim(sh.exec()) at line 1841', async function() {
      // line 1841: trim(sh.exec('echo $$')) — sh.exec returns string, not function
      const diagnostics = await getDiagnostics(pbrContent, PBR_FILE);
      const line1841Diags = diagnostics.filter(d =>
        d.range.start.line === 1840 && d.message && d.message.includes('trim')
      );
      assert.strictEqual(line1841Diags.length, 0,
        `Should not have false positive on trim() at line 1841, got: ${line1841Diags.map(d => d.message).join('; ')}`);
    });

    it('should not have false positive UC2007 diagnostic on sprintf with hex() at line 879', async function() {
      const diagnostics = await getDiagnostics(pbrContent, PBR_FILE);
      const line879Diags = diagnostics.filter(d =>
        d.range.start.line === 878 && d.message && d.message.includes('UC2007')
      );
      assert.strictEqual(line879Diags.length, 0,
        `Should not have UC2007 false positive on hex() at line 879, got: ${line879Diags.map(d => d.message).join('; ')}`);
    });
  });
});
