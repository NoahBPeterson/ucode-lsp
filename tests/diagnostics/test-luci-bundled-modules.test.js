// Bundled luci-base fallback: a STANDALONE LuCI package (Makefile + luci.mk, no LuCI
// checkout anywhere above it) imports luci.* modules from the device at runtime, so
// resolveLuciModulePath falls back to the extension's bundled reference copy
// (resources/luci-base). That gives real cross-file types, member validation, template
// resolution, and typo suggestions — where before every import member was `unknown`.
// Inside a full checkout the tree's own files still win (precedence test at bottom).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, dir, appDir, n = 0;
beforeAll(async () => {
  server = createLSPTestServer(); await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lbb-'));
  fs.writeFileSync(path.join(dir, 'Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
  appDir = path.join(dir, 'ucode/controller');
  fs.mkdirSync(appDir, { recursive: true });
});
afterAll(() => { try { server.shutdown(); } catch {}; fs.rmSync(dir, { recursive: true, force: true }); });

const uri = () => path.join(appDir, `t${n++}.uc`);

async function hoverAt(code, fileUri, needle, delta = 2) {
  const lines = code.split('\n');
  const line = lines.findIndex((l) => l.includes(needle));
  const ch = lines[line].indexOf(needle) + delta;
  const h = await server.getHover(code, fileUri, line, ch);
  return h?.contents?.value ?? null;
}

test('luci.sys import members type as functions, no diagnostics', async () => {
  const code = "import { init_enabled, init_action } from 'luci.sys';\nprint(init_enabled, init_action);\n";
  const v = await hoverAt(code, uri(), 'init_enabled');
  expect(v).toContain('`function`');
  const d = await server.getDiagnostics(code, uri());
  expect((d || []).map((x) => x.code)).toEqual([]);
});

test('importing a member luci.sys does not export is flagged', async () => {
  const code = "import { init_enbaled } from 'luci.sys';\nprint(init_enbaled);\n";
  const d = await server.getDiagnostics(code, uri());
  const codes = (d || []).map((x) => String(x.code));
  expect(codes).toContain('UC3005');
});

test('luci.core (C module stub) types returns precisely', async () => {
  const code = "import { statvfs, translate, getuid } from 'luci.core';\nlet st = statvfs('/');\nlet tr = translate('key');\nlet uid = getuid();\nprint(st, tr, uid);\n";
  expect(await hoverAt(code, uri(), 'st = ', 0)).toContain('`object | null`');
  expect(await hoverAt(code, uri(), 'tr = ', 0)).toContain('`string | null`');
  expect(await hoverAt(code, uri(), 'uid = ', 0)).toContain('`integer`');
  const d = await server.getDiagnostics(code, uri());
  expect((d || []).map((x) => x.code)).toEqual([]);
});

test('luci.version stub provides revision/branch as strings', async () => {
  const code = "import { revision, branch } from 'luci.version';\nprint(revision, branch);\n";
  expect(await hoverAt(code, uri(), 'revision')).toContain('`string`');
  const d = await server.getDiagnostics(code, uri());
  expect((d || []).map((x) => x.code)).toEqual([]);
});

test("include('header') in a template resolves against the bundled template tree", async () => {
  const code = "{% include('header'); %}\n<h1>x</h1>\n";
  const turi = path.join(dir, 'ucode/template/x/main.ut');
  fs.mkdirSync(path.dirname(turi), { recursive: true });
  const d = await server.getDiagnostics(code, turi);
  expect((d || []).filter((x) => /not.*found|Cannot find/i.test(x.message))).toEqual([]);
  const h = await hoverAt(code, path.join(dir, 'ucode/template/x/m2.ut'), "'header'");
  expect(h).toContain('bundled reference');
});

test('typo of a luci-base name suggests it with the runtime-module story', async () => {
  const code = "import { init_enabled } from 'luci.sy';\nprint(init_enabled);\n";
  const d = await server.getDiagnostics(code, uri());
  const msg = (d || []).map((x) => x.message).join('\n');
  expect(msg).toContain("did you mean 'luci.sys'");
  expect(msg).toContain('luci-base runtime module');
});

test('opening a bundled reference file itself publishes no diagnostics', async () => {
  // Users reach these via go-to-definition; lints on code they cannot fix are noise.
  const p = path.resolve(__dirname, '../../resources/luci-base/sys.uc');
  const d = await server.getDiagnostics(fs.readFileSync(p, 'utf8'), p);
  expect(d || []).toEqual([]);
});

test('a checkout tree file wins over the bundled copy', async () => {
  const co = fs.mkdtempSync(path.join(os.tmpdir(), 'lbbco-'));
  const base = path.join(co, 'modules/luci-base/ucode');
  fs.mkdirSync(path.join(base, 'template'), { recursive: true });
  fs.writeFileSync(path.join(base, 'dispatcher.uc'), 'export function menu_json() { return null; };\n');
  fs.writeFileSync(path.join(base, 'runtime.uc'), 'export function render() {};\n');
  // The checkout's OWN sys.uc exports a name the bundled copy does not.
  fs.writeFileSync(path.join(base, 'sys.uc'), 'export function checkout_only_export() { return 1; };\n');
  const cdir = path.join(co, 'applications/luci-app-x/ucode/controller');
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(co, 'applications/luci-app-x/Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
  const code = "import { checkout_only_export } from 'luci.sys';\nprint(checkout_only_export);\n";
  const d = await server.getDiagnostics(code, path.join(cdir, 'c.uc'));
  // Resolving against the BUNDLED copy would flag checkout_only_export as not exported.
  expect((d || []).map((x) => `${x.code} ${x.message}`)).toEqual([]);
  fs.rmSync(co, { recursive: true, force: true });
});
