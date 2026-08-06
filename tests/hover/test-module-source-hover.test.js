// Module-source hovers: the string in `import … from 'x'` / `require('x')` /
// `include('x')` is a module reference, not prose — hover renders registry docs
// (builtins, with their feed-availability floor), the resolved file + export list
// (workspace modules), the device-provided story (unresolvable luci.* in a LuCI
// tree), or the resolved template (include). Ordinary strings keep the literal hover.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function hoverAt(code, uri, needle) {
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes(needle));
  const ch = lines[line].indexOf(needle) + 2; // inside the quotes
  const h = await server.getHover(code, uri, line, ch);
  return h?.contents?.value ?? null;
}

describe('module-source hover', () => {
  test('a builtin module source shows its registry documentation', async () => {
    const v = await hoverAt("import { readfile } from 'fs';\nprint(readfile);\n", `/tmp/msh-${n++}.uc`, "'fs'");
    expect(v).toContain('fs');
    expect(v).not.toContain('(literal)');
  });

  test('a post-22.03 module carries its feed-availability floor', async () => {
    const v = await hoverAt("import { connect } from 'socket';\nprint(connect);\n", `/tmp/msh-${n++}.uc`, "'socket'");
    expect(v).toContain('Available since OpenWrt 24.10');
    expect(v).toContain('ucode-mod-socket');
  });

  test('a workspace module shows its resolved path and export list', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msh-'));
    fs.writeFileSync(path.join(dir, 'helper.uc'), 'export function fn_a() {};\nexport const VAL = 1;\n');
    const uri = path.join(dir, 'main.uc');
    const v = await hoverAt("import { fn_a } from './helper.uc';\nprint(fn_a);\n", uri, "'./helper.uc'");
    expect(v).toContain('helper.uc');
    expect(v).toContain('`fn_a()`');
    expect(v).toContain('`VAL`');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an unresolvable luci.* inside a LuCI tree explains the device-provided story', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msh-'));
    fs.writeFileSync(path.join(dir, 'Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
    fs.mkdirSync(path.join(dir, 'ucode/controller'), { recursive: true });
    const uri = path.join(dir, 'ucode/controller/c.uc');
    const v = await hoverAt("import { x } from 'luci.sys';\nprint(x);\n", uri, "'luci.sys'");
    expect(v).toContain('/usr/share/ucode/luci/');
    expect(v).toContain('installed LuCI package');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("include('name') in a LuCI tree hovers the resolved template", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msh-'));
    fs.writeFileSync(path.join(dir, 'Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
    fs.mkdirSync(path.join(dir, 'ucode/template/app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ucode/template/app/partial.ut'), '<hr>\n');
    const uri = path.join(dir, 'ucode/template/app/main.ut');
    const v = await hoverAt("{% include('app/partial'); %}\n", uri, "'app/partial'");
    expect(v).toContain('Template');
    expect(v).toContain('partial.ut');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an ordinary string keeps the plain literal hover', async () => {
    const v = await hoverAt("let s = 'lucihttp';\nprint(s);\n", `/tmp/msh-${n++}.uc`, "'lucihttp'");
    expect(v).toContain('(literal)');
  });
});
