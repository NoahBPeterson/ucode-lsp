// Standalone tests for type narrowing, hex() return type, and cross-file
// property function return types. These replace the PBR-dependent tests that
// relied on a 2000-line real-world file.

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

describe('Standalone Type Narrowing & Return Type Tests', function() {
  this.timeout(30000);

  let lspServer, getHover, getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  const testFile = '/tmp/test-narrowing-standalone.uc';

  // ── 1. type() guard narrows union to specific type ──────────────
  describe('type() guard narrowing', function() {
    it('should narrow unknown | array | string to array after type() == "array" guard', async function() {
      // Simulates: let x = get_something(); if (type(x) != 'array') return; use(x);
      const code = `
function get_option() {
    if (time() > 100) return null;
    if (time() > 50) return "hello";
    return [1, 2, 3];
}
function process() {
    let opt = get_option();
    if (type(opt) != 'array')
        return;
    for (let item in opt) {
        print(item);
    }
}
process();
`;
      const lines = code.split('\n');
      // Hover on 'opt' inside the for-in loop (after the type guard)
      const forLine = lines.findIndex(l => l.includes('for (let item in opt'));
      const charIdx = lines[forLine].indexOf('opt');
      const hover = await getHover(code, testFile, forLine, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('array'),
        `Expected 'array' for opt after type() guard, got: ${text}`);
    });

    it('should narrow to string after type() == "string" guard', async function() {
      const code = `
function maybe_string() {
    if (time() > 50) return null;
    return "hello";
}
function process() {
    let val = maybe_string();
    if (type(val) != 'string')
        return;
    let len = length(val);
    print(len);
}
process();
`;
      const lines = code.split('\n');
      const lenLine = lines.findIndex(l => l.includes('length(val)'));
      const charIdx = lines[lenLine].indexOf('val');
      const hover = await getHover(code, testFile, lenLine, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' for val after type() guard, got: ${text}`);
    });
  });

  // ── 2. hex() return type is integer ─────────────────────────────
  describe('hex() return type', function() {
    it('should type hex() result as integer', async function() {
      const code = `
let mark_str = "0x1234";
let mark = hex(mark_str);
print(mark);
`;
      const lines = code.split('\n');
      const markLine = lines.findIndex(l => l.includes('let mark = hex'));
      const charIdx = lines[markLine].indexOf('mark');
      const hover = await getHover(code, testFile, markLine, charIdx);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('integer'),
        `Expected 'integer' for hex() result, got: ${text}`);
    });

    it('should not produce UC2007 when hex() result is used in sprintf %x', async function() {
      const code = `
let mark_str = "0x1234";
let iface_mark = sprintf('0x%06x', hex(mark_str));
print(iface_mark);
`;
      const diags = await getDiagnostics(code, testFile);
      const uc2007 = diags.filter(d => d.code === 'UC2007');
      assert.strictEqual(uc2007.length, 0,
        `hex() returns integer, sprintf %x should not produce UC2007, got: ${uc2007.map(d => d.message).join('; ')}`);
    });
  });

  // ── 3. Cross-file property function return types (sh.exec pattern) ─
  describe('cross-file property function return types', function() {
    const tmpDir = path.join(__dirname, 'tmp-sh-exec-test');
    const shModFile = path.join(tmpDir, 'sh.uc');
    const consumerFile = path.join(tmpDir, '_test_consumer.uc');

    before(function() {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      // Simulate a shell module that exports exec/run functions
      fs.writeFileSync(shModFile, `'use strict';

function exec(cmd) {
    // In real code, this would execute a command and return stdout as string
    return "output of " + cmd;
}

function run(cmd) {
    // In real code, this would execute a command and return exit code
    return 0;
}

function quote(str) {
    return "'" + str + "'";
}

export default { exec, run, quote };
`);
    });

    after(function() {
      try { fs.unlinkSync(shModFile); fs.unlinkSync(consumerFile); fs.rmdirSync(tmpDir); } catch {}
    });

    it('should type sh.exec() result as string', async function() {
      const code = [
        "import sh from 'sh';",
        "let result = sh.exec('ls -la');",
        "print(result);",
      ].join('\n');
      const hover = await getHover(code, consumerFile, 1, 4);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('string'),
        `Expected 'string' for sh.exec() result, got: ${text}`);
    });

    it('should type sh.run() result as integer', async function() {
      const code = [
        "import sh from 'sh';",
        "let rc = sh.run('echo hello');",
        "print(rc);",
      ].join('\n');
      const hover = await getHover(code, consumerFile, 1, 4);
      const text = extractHoverText(hover);
      assert.ok(text.toLowerCase().includes('integer'),
        `Expected 'integer' for sh.run() result, got: ${text}`);
    });

    it('should not produce false positive on index(sh.exec())', async function() {
      const code = [
        "import sh from 'sh';",
        "let out = sh.exec('ip route');",
        "if (index(out, 'default') >= 0) {",
        "    print('found');",
        "}",
      ].join('\n');
      const diags = await getDiagnostics(code, consumerFile);
      const indexWarnings = diags.filter(d =>
        d.message && d.message.includes('index') && (d.message.includes('unknown') || d.message.includes('function'))
      );
      assert.strictEqual(indexWarnings.length, 0,
        `index(sh.exec()) should not warn, got: ${indexWarnings.map(d => d.message).join('; ')}`);
    });

    it('should not produce false positive on trim(sh.exec())', async function() {
      const code = [
        "import sh from 'sh';",
        "let cleaned = trim(sh.exec('echo hello'));",
        "print(cleaned);",
      ].join('\n');
      const diags = await getDiagnostics(code, consumerFile);
      const trimWarnings = diags.filter(d =>
        d.message && d.message.includes('trim') && (d.message.includes('unknown') || d.message.includes('function'))
      );
      assert.strictEqual(trimWarnings.length, 0,
        `trim(sh.exec()) should not warn, got: ${trimWarnings.map(d => d.message).join('; ')}`);
    });
  });
});
