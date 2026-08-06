// 0.8.0 behavior corners — 80 unit tests over the grand-tour feature set:
//   A. workspace detection (checkout/package/deployed/negative + cache soundness)
//   B. env ambient + render-compat names (per-name gating, templates vs controllers)
//   C. luci.* module resolution + Lua-view fallback
//   D. include/render scope extraction (paths, patterns, identifier mining, edges)
//   E. UC6020 comment-ended-early corners
//   F. missing-argument (@param optional) semantics
//   G. unknown-member anchoring
// Companion e2e quick-fix suite: tests/test-luci-0800-quickfixes.test.js.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { detectTemplateMode, detectTemplateModeForFile, bridgeTemplateTokens } from '../../src/lexer/templateMode.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { buildIncludeScopeIndex, checkIncludeScopes, extractIncludeSites } from '../../src/analysis/includeScope.ts';
import {
  findLuciWorkspace, isLuciEnvFile, getLuciTemplateRoots, resolveLuciTemplatePath,
  resolveLuciTemplatePattern, resolveLuciModulePath, hasLuciLuaViewFallback, clearLuciWorkspaceCache,
} from '../../src/analysis/luciEnv.ts';
import { LUCI_TEMPLATE_RENDER_COMPAT_NAMES, LUCI_ENV_GLOBALS } from '../../src/analysis/luciTypes.ts';

const LUCI_MAKEFILE = 'include $(TOPDIR)/rules.mk\n\nLUCI_TITLE:=T\n\ninclude $(TOPDIR)/feeds/luci/luci.mk\n';
let root; // shared synthetic checkout

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-corner-'));
  const put = (rel, content) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  put('modules/luci-base/ucode/dispatcher.uc', '// stub\n');
  put('modules/luci-base/ucode/template/header.ut', '<html>\n');
  put('applications/luci-app-c/ucode/controller/c.uc', '// stub\n');
  clearLuciWorkspaceCache();
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); clearLuciWorkspaceCache(); });

function mkDoc(code, uri) {
  return {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else c++; } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri, languageId: 'ucode', version: 1,
  };
}
function parseFor(p, code) {
  const isT = detectTemplateModeForFile(p, code);
  const lx = new UcodeLexer(code, { rawMode: !isT });
  const parser = new UcodeParser(isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize(), code);
  parser.setComments(lx.comments);
  return { ast: parser.parse().ast, lexErrors: lx.errors };
}
function analyzeAt(rel, code) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, code);
  const doc = mkDoc(code, 'file://' + p);
  const { ast } = parseFor(p, code);
  const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
  return { doc, ar };
}
function analyzePlain(code, uri = 'file:///plain-t.uc') {
  const doc = mkDoc(code, uri);
  const { ast } = parseFor(uri, code);
  const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
  return { doc, ar };
}
const msgs = (ar) => ar.diagnostics.map((d) => d.message);
const sev = (ar, n) => ar.diagnostics.filter((d) => d.severity === n).map((d) => d.message);
function mkTree(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-c2-'));
  for (const [rel, content] of Object.entries(layout)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  clearLuciWorkspaceCache();
  return dir;
}

// ═══ A. workspace detection ═════════════════════════════════════════════════════════

describe('A. detection corners', () => {
  test('A1 LUCI_TITLE alone (no luci.mk include) is package evidence', () => {
    const d = mkTree({ 'Makefile': 'include $(TOPDIR)/rules.mk\nLUCI_TITLE:=X\n', 'ucode/template/x.ut': '{% %}' });
    expect(findLuciWorkspace(path.join(d, 'ucode/template/x.ut'))?.kind).toBe('package');
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A2 luci.mk include alone (no LUCI_TITLE) is package evidence', () => {
    const d = mkTree({ 'Makefile': 'include ../../luci.mk\n', 'ucode/template/x.ut': '{% %}' });
    expect(findLuciWorkspace(path.join(d, 'ucode/template/x.ut'))?.kind).toBe('package');
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A3 in-tree relative form `include ../../luci.mk` matches', () => {
    const d = mkTree({ 'apps/p/Makefile': 'LUCI_TITLE:=X\ninclude ../../luci.mk\n', 'apps/p/ucode/template/x.ut': '{% %}' });
    expect(findLuciWorkspace(path.join(d, 'apps/p/ucode/template/x.ut'))?.root).toBe(path.join(d, 'apps/p'));
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A4 an ordinary package.mk Makefile is NOT evidence', () => {
    const d = mkTree({ 'Makefile': 'PKG_NAME:=x\ninclude $(INCLUDE_DIR)/package.mk\n', 'files/x.ut': '{% %}' });
    expect(findLuciWorkspace(path.join(d, 'files/x.ut'))).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A5 a directory with no Makefile at all is NOT a package', () => {
    const d = mkTree({ 'ucode/template/x.ut': '{% %}' });
    expect(findLuciWorkspace(path.join(d, 'ucode/template/x.ut'))).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A6 a package buried deeper than MAX_ASCENT is not found (bounded walk)', () => {
    const deep = 'a/b/c/d/e/f/g/h/i/j/k';
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, [`${deep}/x.ut`]: '{% %}' });
    expect(findLuciWorkspace(path.join(d, deep, 'x.ut'))).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A7 deployed: a controller directly under <root>/controller/ is an env file', () => {
    const d = mkTree({ 'rt/dispatcher.uc': '//', 'rt/runtime.uc': '//', 'rt/template/x.ut': '<p>', 'rt/controller/c.uc': '//' });
    expect(isLuciEnvFile(path.join(d, 'rt/controller/c.uc'))?.ws.kind).toBe('deployed');
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A8 deployed: a NON-controller .uc beside the runtime is not an env file', () => {
    const d = mkTree({ 'rt/dispatcher.uc': '//', 'rt/runtime.uc': '//', 'rt/template/x.ut': '<p>', 'rt/http.uc': '//' });
    expect(isLuciEnvFile(path.join(d, 'rt/http.uc'))).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A9 a template-mode .uc under ucode/template/ is NOT env (only .ut and controllers)', () => {
    const p = path.join(root, 'applications/luci-app-c/ucode/template/frag.uc');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{% print(theme); %}');
    clearLuciWorkspaceCache();
    expect(isLuciEnvFile(p)).toBeNull();
  });
  test('A10 a /controller/ path OUTSIDE any deployed root is not env', () => {
    const d = mkTree({ 'x/controller/c.uc': 'print(http);\n' });
    expect(isLuciEnvFile(path.join(d, 'x/controller/c.uc'))).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A11 package verdict does not leak DOWNWARD past a nested non-LuCI package', () => {
    // pkg/vendor/other has its own plain Makefile; files under it still resolve to the
    // outer LuCI package (nearest LuCI evidence wins on the way up).
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, 'vendor/other/Makefile': 'PKG_NAME:=v\n', 'vendor/other/x.ut': '{% %}' });
    expect(findLuciWorkspace(path.join(d, 'vendor/other/x.ut'))?.root).toBe(d);
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('A12 template roots for a package = its own ucode/template only', () => {
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, 'ucode/template/x.ut': '{% %}' });
    const ws = findLuciWorkspace(path.join(d, 'ucode/template/x.ut'));
    expect(getLuciTemplateRoots(ws)).toEqual([path.join(d, 'ucode/template')]);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

// ═══ B. env ambient + compat names ══════════════════════════════════════════════════

describe('B. env ambient per-name gating', () => {
  // Every compat name: quiet in a template, flagged in a controller.
  for (const name of LUCI_TEMPLATE_RENDER_COMPAT_NAMES) {
    test(`B-compat '${name}' is quiet in a .ut template`, () => {
      const { ar } = analyzeAt(`applications/luci-app-c/ucode/template/cmp_${name}.ut`, `{% print(${name}); %}`);
      expect(msgs(ar).filter((m) => m.includes(`Undefined variable: ${name}`))).toEqual([]);
    });
  }
  test('B1 a compat name IS flagged in a controller (templates only)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/cmp.uc', 'print(duser);\n');
    expect(msgs(ar).some((m) => m.includes('Undefined variable: duser'))).toBe(true);
  });
  test('B2 every env global resolves in a controller (no undefined)', () => {
    const names = LUCI_ENV_GLOBALS.map((g) => g.name).join(', ');
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/envall.uc', `print(${names});\n`);
    expect(msgs(ar).filter((m) => /Undefined/.test(m))).toEqual([]);
  });
  test('B3 top-level `export let` of an env name wins over the ambient', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/expl.uc',
      'export let theme = 42;\nlet doubled = theme * 2;\nprint(doubled);\n');
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B4 `import { default as http }` wins over the ambient http', () => {
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/hstub.uc'), 'export default function() { return 1; };\n');
    clearLuciWorkspaceCache();
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/impd.uc',
      "import { default as http } from 'luci.hstub';\nlet r = http();\nprint(r);\n");
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B5 _() feeds sprintf %s cleanly (definite string return)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/tr.uc', "print(sprintf('%s', _('x')));\n");
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B6 N_(n, a, b) with three args is clean (variadic rest tail)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/nn.uc', "print(N_(2, 'cat', 'cats'));\n");
    expect(msgs(ar).filter((m) => /argument/i.test(m))).toEqual([]);
  });
  test('B7 pkgs_update_time does integer arithmetic cleanly', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/template/pt.ut', '{% let v = pkgs_update_time + 1; print(v); %}');
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B8 lua_active is boolean-typed (usable in a ternary)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/template/la.ut', "{% print(lua_active ? 'lua' : 'ucode'); %}");
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B9 config?.apply?.rollback chains cleanly (plain object env member)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/cfg.uc', 'print(+(config?.apply?.rollback ?? 90));\n');
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B10 dispatcher.lang is a value member (no call needed, no diagnostics)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/template/dl.ut', '{% print(dispatcher.lang); %}');
    expect(sev(ar, 1)).toEqual([]);
  });
  test('B11 dispatcher.build_url(...) variadic segments are clean', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/bu.uc', "print(dispatcher.build_url('a', 'b', 'c'));\n");
    expect(msgs(ar).filter((m) => /argument/i.test(m))).toEqual([]);
  });
  test('B12 env names are NOT seeded in a plain module inside the checkout', () => {
    const { ar } = analyzeAt('modules/luci-base/ucode/plainmod.uc', 'print(theme);\n');
    expect(msgs(ar).some((m) => m.includes('Undefined variable: theme'))).toBe(true);
  });
  test('B13 the ambient http never reports as unused', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/unused.uc', 'print(1);\n');
    expect(msgs(ar).filter((m) => /never used/i.test(m))).toEqual([]);
  });
  test('B14 a local named after an env global draws no shadow warning', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/shadow.uc',
      'function f() { let ubus = 1; return ubus; }\nprint(f());\n');
    expect(msgs(ar).filter((m) => /shadows/.test(m))).toEqual([]);
  });
  test('B15 a nested loop-local of an env name keeps the ambient elsewhere', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/loopl.uc',
      'function a() { return version?.distname; }\nfunction b(xs) { for (let version in xs) print(version); }\nprint(a, b);\n');
    expect(msgs(ar).filter((m) => /Undefined variable: version|shadows/.test(m))).toEqual([]);
  });
});

// ═══ C. luci.* modules + Lua-view fallback ══════════════════════════════════════════

describe('C. luci.* + Lua fallback', () => {
  test('C1 luci.<pkg-shipped> module resolves inside a standalone package', () => {
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, 'ucode/helper.uc': 'export function h() { return 1; };\n', 'ucode/template/x.ut': '{% %}' });
    expect(resolveLuciModulePath(path.join(d, 'ucode/template/x.ut'), 'luci.helper'))
      .toBe(path.join(d, 'ucode/helper.uc'));
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('C2 nested dotted name maps to nested path (luci.a.b → ucode/a/b.uc)', () => {
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, 'ucode/a/b.uc': 'export function f() {};\n', 'ucode/template/x.ut': '{% %}' });
    expect(resolveLuciModulePath(path.join(d, 'ucode/template/x.ut'), 'luci.a.b')).toBe(path.join(d, 'ucode/a/b.uc'));
    fs.rmSync(d, { recursive: true, force: true });
  });
  test("C3 bare 'luci' (no dot) is never resolved by the mapping", () => {
    expect(resolveLuciModulePath(path.join(root, 'applications/luci-app-c/ucode/controller/c.uc'), 'luci')).toBeNull();
  });
  test('C4 unresolvable luci.* import is silent in a PACKAGE', () => {
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, 'ucode/controller/c.uc': "import { x } from 'luci.absent';\nprint(x);\n" });
    const p = path.join(d, 'ucode/controller/c.uc');
    const { ar } = (() => { const doc = mkDoc(fs.readFileSync(p, 'utf8'), 'file://' + p); const { ast } = parseFor(p, fs.readFileSync(p, 'utf8')); return { ar: new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast) }; })();
    expect(msgs(ar).filter((m) => /Cannot find module/.test(m))).toEqual([]);
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('C5 unresolvable luci.* import still flags OUTSIDE any LuCI tree', () => {
    const { ar } = analyzePlain("import { x } from 'luci.absent';\nprint(x);\n");
    expect(msgs(ar).some((m) => /Cannot find module 'luci.absent'/.test(m))).toBe(true);
  });
  test('C6 a NON-luci unresolvable module still flags inside the checkout', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/nl.uc', "import { x } from 'totally.absent';\nprint(x);\n");
    expect(msgs(ar).some((m) => /Cannot find module/.test(m))).toBe(true);
  });
  test('C7 hasLuciLuaViewFallback finds a checkout modules/*/luasrc view', () => {
    fs.mkdirSync(path.join(root, 'modules/luci-lua-runtime/luasrc/view/adm'), { recursive: true });
    fs.writeFileSync(path.join(root, 'modules/luci-lua-runtime/luasrc/view/adm/idx.htm'), '<x>');
    clearLuciWorkspaceCache();
    expect(hasLuciLuaViewFallback(path.join(root, 'modules/luci-base/ucode/template/header.ut'), 'adm/idx')).toBe(true);
  });
  test('C8 fallback also works from an applications/*/luasrc view dir', () => {
    fs.mkdirSync(path.join(root, 'applications/luci-app-c/luasrc/view'), { recursive: true });
    fs.writeFileSync(path.join(root, 'applications/luci-app-c/luasrc/view/cpage.htm'), '<x>');
    clearLuciWorkspaceCache();
    expect(hasLuciLuaViewFallback(path.join(root, 'modules/luci-base/ucode/template/header.ut'), 'cpage')).toBe(true);
  });
  test('C9 fallback in a PACKAGE looks at <pkg>/luasrc/view', () => {
    const d = mkTree({ 'Makefile': LUCI_MAKEFILE, 'luasrc/view/leg.htm': '<x>', 'ucode/template/x.ut': '{% %}' });
    expect(hasLuciLuaViewFallback(path.join(d, 'ucode/template/x.ut'), 'leg')).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('C11 a TYPO of a package-shipped luci.* module gets a did-you-mean warning', () => {
    const d = mkTree({
      'Makefile': LUCI_MAKEFILE,
      'ucode/podman_validate.uc': 'export function validate_id(s) { return s; };\n',
      'ucode/template/x.ut': '{% %}',
    });
    const p = path.join(d, 'root/usr/share/rpcd/ucode/b.uc');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const code = "import { validate_id } from 'luci.podman_validated';\nprint(validate_id);\n";
    fs.writeFileSync(p, code);
    const doc = mkDoc(code, 'file://' + p);
    const { ast } = parseFor(p, code);
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
    const m = msgs(ar).filter((x) => /did you mean 'luci.podman_validate'/.test(x));
    expect(m.length).toBe(1);
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('C12 an unresolvable luci.* FAR from anything shipped stays silent', () => {
    const d = mkTree({
      'Makefile': LUCI_MAKEFILE,
      'ucode/podman_validate.uc': 'export function v() {};\n',
      'ucode/template/x.ut': '{% %}',
    });
    const p = path.join(d, 'ucode/controller/c.uc');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const code = "import { x } from 'luci.completely_unrelated';\nprint(x);\n";
    fs.writeFileSync(p, code);
    const doc = mkDoc(code, 'file://' + p);
    const { ast } = parseFor(p, code);
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
    expect(msgs(ar).filter((x) => /Cannot find/.test(x))).toEqual([]);
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('C13 the suggestion works in a FULL CHECKOUT against luci-base modules too', () => {
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/sys.uc'), 'export function init_enabled() {};\n');
    clearLuciWorkspaceCache();
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/typo.uc',
      "import { init_enabled } from 'luci.sys2';\nprint(init_enabled);\n");
    expect(msgs(ar).some((x) => /did you mean 'luci.sys'/.test(x))).toBe(true);
  });
  test('C14 luci.core in a checkout has no near-match — still silent (compiled module)', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/core2.uc',
      "import { hash } from 'luci.core';\nprint(hash);\n");
    expect(msgs(ar).filter((x) => /Cannot find/.test(x))).toEqual([]);
  });
  test('C15 nested shipped modules suggest with dotted names', () => {
    const d = mkTree({
      'Makefile': LUCI_MAKEFILE,
      'ucode/plugins/auth/demo.uc': 'export function check() {};\n',
      'ucode/template/x.ut': '{% %}',
    });
    const p = path.join(d, 'ucode/controller/c.uc');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const code = "import { check } from 'luci.plugins.auth.demos';\nprint(check);\n";
    fs.writeFileSync(p, code);
    const doc = mkDoc(code, 'file://' + p);
    const { ast } = parseFor(p, code);
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ast);
    expect(msgs(ar).some((x) => /did you mean 'luci.plugins.auth.demo'/.test(x))).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });
  test('C10 no fallback claim for pattern or absolute names', () => {
    const from = path.join(root, 'modules/luci-base/ucode/template/header.ut');
    expect(hasLuciLuaViewFallback(from, 'themes/*/header')).toBe(false);
    expect(hasLuciLuaViewFallback(from, '/etc/x')).toBe(false);
  });
});

// ═══ D. include/render scope extraction ═════════════════════════════════════════════

describe('D. extraction corners', () => {
  const parse = (code) => parseFor('/x/t.uc', code).ast;

  test('D1 string-literal object keys are collected', () => {
    const [s] = extractIncludeSites(parse(`include('t', { 'a-b': 1, plain: 2 });`));
    expect(s.scopeKeys.sort()).toEqual(['a-b', 'plain']);
  });
  test('D2 a computed key marks dynamic but keeps the static keys', () => {
    const [s] = extractIncludeSites(parse(`include('t', { a: 1, [k]: 2 });`));
    expect(s.scopeKeys).toEqual(['a']);
    expect(s.hasDynamicScope).toBe(true);
  });
  test('D3 a spread marks dynamic but keeps the static keys', () => {
    const [s] = extractIncludeSites(parse(`include('t', { a: 1, ...rest });`));
    expect(s.scopeKeys).toEqual(['a']);
    expect(s.hasDynamicScope).toBe(true);
  });
  test('D4 shorthand properties contribute their names', () => {
    const [s] = extractIncludeSites(parse(`let fw4 = 1;\ninclude('t', { fw4 });`));
    expect(s.scopeKeys).toEqual(['fw4']);
  });
  test('D5 identifier scope: bracket-string member assigns are mined', () => {
    const [s] = extractIncludeSites(parse(`let sc = {};\nsc['k1'] = 1;\nsc.k2 = 'x';\ninclude('t', sc);`));
    expect(s.scopeKeys.sort()).toEqual(['k1', 'k2']);
  });
  test('D6 identifier scope with a NON-object initializer yields no keys (still dynamic)', () => {
    const [s] = extractIncludeSites(parse(`let sc = 5;\ninclude('t', sc);`));
    expect(s.scopeKeys).toEqual([]);
    expect(s.hasDynamicScope).toBe(true);
  });
  test('D7 callback hop honors a NON-zero function-arg position', () => {
    const ast = parse(`
function g(tag, cb) { cb({ hopped: 1 }); }
function f(res) { include('t', res); }
g('x', f);
`);
    const [s] = extractIncludeSites(ast);
    expect(s.scopeKeys).toEqual(['hopped']);
  });
  test('D8 direct calls AND callback-hop literals merge', () => {
    const ast = parse(`
function f(res) { include('t', res); }
f({ direct: 1 });
function g(cb) { cb({ viacb: 2 }); }
g(f);
`);
    const [s] = extractIncludeSites(ast);
    expect(s.scopeKeys.sort()).toEqual(['direct', 'viacb']);
  });
  test('D9 conflicting value types for one key degrade to unknown, key survives', () => {
    const ast = parse(`function f(r) { include('t', r); }\nf({ x: 1 });\nf({ x: 'y' });`);
    const [s] = extractIncludeSites(ast);
    expect(s.scopeValues.x).toEqual({ kind: 'unknown' });
  });
  test('D10 a template literal with TWO interpolations becomes a two-star pattern', () => {
    const [s] = extractIncludeSites(parse('include(`a${x}b${y}c`, { k: 1 });'));
    expect(s.path).toBe('a*b*c');
    expect(s.isPattern).toBe(true);
  });
  test('D11 an interpolation-free template literal is a plain path', () => {
    const [s] = extractIncludeSites(parse('include(`plain/name`, { k: 1 });'));
    expect(s.path).toBe('plain/name');
    expect(s.isPattern).toBe(false);
  });
  test('D12 an identifier path with one non-path initializer is dropped', () => {
    expect(extractIncludeSites(parse(`let p = 5;\nrender(p, { k: 1 });`))).toEqual([]);
  });
  test('D13 an undeclared identifier path is dropped', () => {
    expect(extractIncludeSites(parse(`render(mystery_path, { k: 1 });`))).toEqual([]);
  });
  test('D14 deep member chains still count as render sites (a.b.render)', () => {
    const [s] = extractIncludeSites(parse(`let a = { b: { render: function(n, s) {} } };\na.b.render('t', { k: 1 });`));
    expect(s.via).toBe('render');
    expect(s.path).toBe('t');
  });
  test('D15 a computed member call (x["render"]) is NOT a render site', () => {
    expect(extractIncludeSites(parse(`let x = {};\nx['render']('t', { k: 1 });`))).toEqual([]);
  });
  test('D16 in the index, a literal render site needs the template hook (no relative fallback)', () => {
    const idx = buildIncludeScopeIndex(
      [{ path: '/w/a.uc', ast: parse(`function go(r) { r.render('t', { k: 1 }); }`) }]);
    expect(idx.size).toBe(0);
  });
  test('D17 in the index, a pattern site without the pattern hook is dropped', () => {
    const idx = buildIncludeScopeIndex(
      [{ path: '/w/a.uc', ast: parse('include(`th/${x}/y`, { k: 1 });') }]);
    expect(idx.size).toBe(0);
  });
  test('D18 a bare RENDER is an edge too: the renderer\'s own injected scope leaks on', () => {
    const idx = buildIncludeScopeIndex([
      { path: '/w/top.uc', ast: parse(`include('mid.uc', { leaked: 1 });`) },
      { path: '/w/mid.uc', ast: parse(`function go(r) { r.render('leaf', null); }`) },
    ], { resolveTargetPath: (raw) => (raw === 'leaf' ? '/w/leaf.ut' : null) });
    expect([...(idx.get('/w/leaf.ut')?.injectedNames ?? [])]).toEqual(['leaked']);
  });
  test('D19 checkIncludeScopes skips pattern sites outright', () => {
    const diags = checkIncludeScopes(
      parse('include(`th/${x}/y`, { a: 1 });'), '/w/a.uc',
      () => new Set(['missing_name']), () => false, undefined, () => null);
    expect(diags).toEqual([]);
  });
  test('D20 mutual bare-include cycle reaches a fixpoint without hanging', () => {
    const idx = buildIncludeScopeIndex([
      { path: '/w/a.uc', ast: parse(`include('b.uc');`) },
      { path: '/w/b.uc', ast: parse(`include('a.uc');`) },
      { path: '/w/seed.uc', ast: parse(`include('a.uc', { s: 1 });`) },
    ]);
    expect([...(idx.get('/w/b.uc')?.injectedNames ?? [])]).toEqual(['s']);
  });
});

// ═══ E. UC6020 corners ══════════════════════════════════════════════════════════════

describe('E. UC6020 corners', () => {
  const lex6020 = (src) => {
    const lx = new UcodeLexer(src, { rawMode: false });
    lx.tokenize();
    return lx.errors.filter((e) => e.code === 'UC6020');
  };
  test('E1 a stray terminator directly abutting the close flags', () => {
    const errs = lex6020('{# a #}#}\n{% let a = 1; %}');
    expect(errs.length).toBe(1);
  });
  test('E2 EOF right after a clean close: no claim', () => {
    expect(lex6020('{# fine #}')).toEqual([]);
  });
  test('E3 trim-modifier open `{#-` closes normally without a claim', () => {
    expect(lex6020('{#- trimmed -#}\n<p>x</p>\n{% let a = 1; %}')).toEqual([]);
  });
  test('E4 an unterminated comment is the parser error, not UC6020', () => {
    expect(lex6020('{# never closed')).toEqual([]);
  });
  test('E5 two clean comments then one trap: exactly one claim', () => {
    const errs = lex6020('{# one #} {# two #}\n{# trap #} tail -#}\n{% let a = 1; %}');
    expect(errs.length).toBe(1);
  });
  test('E6 data.intendedStart points at the LAST terminator of the text run', () => {
    const src = '{# a #} b #} c -#}\n{% let a = 1; %}';
    const [e] = lex6020(src);
    expect(e.data.commentEndedEarly.intendedStart).toBe(src.indexOf('-#}'));
  });
  test('E7 the flagged range is the FIRST stray terminator', () => {
    const src = '{# a #} b #} c -#}\n{% let a = 1; %}';
    const [e] = lex6020(src);
    expect(src.slice(e.start, e.end)).toBe('#}');
    expect(e.start).toBe(src.indexOf('#}', src.indexOf('b')));
  });
  test('E8 raw (non-template) sources never produce UC6020', () => {
    const lx = new UcodeLexer('let s = "{# a #} b #}";\n', { rawMode: true });
    lx.tokenize();
    expect(lx.errors.filter((e) => e.code === 'UC6020')).toEqual([]);
  });
});

// ═══ F. missing-argument (@param optional) semantics ════════════════════════════════

describe('F. missing-arg semantics', () => {
  const missing = (ar) => msgs(ar).filter((m) => /omitting it passes null/.test(m));

  test('F1 [name] brackets silence the missing-arg claim', () => {
    const { ar } = analyzePlain('/** @param {string} [a] */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F2 {string=} silences it', () => {
    const { ar } = analyzePlain('/** @param {string=} a */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F3 {?string} silences it', () => {
    const { ar } = analyzePlain('/** @param {?string} a */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F4 {string?} silences it', () => {
    const { ar } = analyzePlain('/** @param {string?} a */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F5 an explicit {string|null} union silences it', () => {
    const { ar } = analyzePlain('/** @param {string|null} a */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F6 a null-free union ({object|string}) is REQUIRED', () => {
    const { ar } = analyzePlain('/** @param {object|string} a */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar).length).toBe(1);
  });
  test('F7 an unannotated parameter is silent (unknown type, no claim)', () => {
    const { ar } = analyzePlain('function f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F8 a JSDoc tag naming a DIFFERENT parameter leaves the real one unannotated (silent)', () => {
    const { ar } = analyzePlain('/** @param {string} zzz */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F9 [name=default] parses as optional', () => {
    const { ar } = analyzePlain("/** @param {string} [a='x'] */\nfunction f(a) { return a; }\nf();\n");
    expect(missing(ar)).toEqual([]);
  });
  test('F10 one missing param → one claim naming it; earlier supplied ones are silent', () => {
    const { ar } = analyzePlain('/**\n * @param {string} a\n * @param {integer} b\n */\nfunction f(a, b) { return [a, b]; }\nf("x");\n');
    const m = missing(ar);
    expect(m.length).toBe(1);
    expect(m[0]).toContain("'b'");
  });
  test('F11 a spread argument disables the arity claim entirely (unknowable count)', () => {
    const { ar } = analyzePlain('/**\n * @param {string} a\n * @param {integer} b\n */\nfunction f(a, b) { return [a, b]; }\nlet xs = ["x"];\nf(...xs);\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F12 a rest parameter is never reported missing', () => {
    const { ar } = analyzePlain('/** @param {string} a */\nfunction f(a, ...rest) { return [a, rest]; }\nf("x");\n');
    expect(missing(ar)).toEqual([]);
  });
  test('F13 non-strict: the claim is a WARNING', () => {
    const { ar } = analyzePlain('/** @param {string} a */\nfunction f(a) { return a; }\nf();\n');
    expect(sev(ar, 2).filter((m) => /omitting/.test(m)).length).toBe(1);
  });
  test("F14 'use strict': the claim escalates to an ERROR", () => {
    const { ar } = analyzePlain("'use strict';\n/** @param {string} a */\nfunction f(a) { return a; }\nf();\n");
    expect(sev(ar, 1).filter((m) => /omitting/.test(m)).length).toBe(1);
  });
  test('F15 EXTRA arguments stay a warning even under strict (ucode ignores them)', () => {
    const { ar } = analyzePlain("'use strict';\n/** @param {string} a */\nfunction f(a) { return a; }\nf('x', 'y');\n");
    expect(sev(ar, 2).filter((m) => /extra arguments are ignored/.test(m)).length).toBe(1);
    expect(sev(ar, 1).filter((m) => /extra arguments/.test(m))).toEqual([]);
  });
  test('F16 the claim anchors on the CALLEE name, not the argument list', () => {
    const code = 'let pad = 1;\n/** @param {string} a */\nfunction f(a) { return a; }\nf();\n';
    const { ar } = analyzePlain(code);
    const d = ar.diagnostics.find((x) => /omitting/.test(x.message));
    expect(d.range.start.line).toBe(3);
    expect(d.range.start.character).toBe(0);
    expect(d.range.end.character).toBe(1);
  });
  test('F17 the message spells out the exact optional syntax to add', () => {
    const { ar } = analyzePlain('/** @param {string} a */\nfunction f(a) { return a; }\nf();\n');
    expect(missing(ar)[0]).toContain('@param {string} [a]');
  });
  test('F18 an optional param types as T|null INSIDE the body (guard is load-bearing)', () => {
    // ord() does not tolerate null, so ord(string|null) proves the null member the
    // bracket syntax added to the parameter's type.
    const { ar } = analyzePlain('/** @param {string} [a] */\nfunction f(a) { return ord(a); }\nf("x");\n');
    expect(msgs(ar).some((m) => /Argument 1 of ord\(\) may be null/.test(m))).toBe(true);
  });
  test('F19 an inner optional param followed by a supplied one: only true gaps flag', () => {
    const { ar } = analyzePlain('/**\n * @param {string} [a]\n * @param {integer} b\n */\nfunction f(a, b) { return [a, b]; }\nf("x");\n');
    const m = missing(ar);
    expect(m.length).toBe(1);
    expect(m[0]).toContain("'b'");
  });
  test('F20 calling through a variable binding of the function keeps the claim', () => {
    const { ar } = analyzePlain('/** @param {string} a */\nfunction f(a) { return a; }\nlet g = f;\ng();\n');
    // Whether the alias carries the signature is a design point — pin the CURRENT
    // behavior so a change is a conscious decision: today the alias DOES carry it.
    expect(missing(ar).length).toBe(1);
  });
});

// ═══ G. unknown-member anchoring ════════════════════════════════════════════════════

describe('G. member-error anchoring', () => {
  test('G1 method call: range is the member id, not the base', () => {
    const code = "let c = uci.not_real('x');\nprint(c);\n";
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/g1.uc', code);
    const d = ar.diagnostics.find((x) => /not_real/.test(x.message));
    expect(d.message).toContain("Method 'not_real' does not exist on uci.cursor");
    expect(d.range.start.character).toBe(code.indexOf('not_real'));
  });
  test('G2 property READ: labeled Property, same member-only anchoring', () => {
    const code = 'let v = uci.not_real;\nprint(v);\n';
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/g2.uc', code);
    const d = ar.diagnostics.find((x) => /not_real/.test(x.message));
    expect(d.message).toContain("Property 'not_real' does not exist on uci.cursor");
    expect(d.range.start.character).toBe(code.indexOf('not_real'));
  });
  test('G3 a KNOWN member produces no diagnostic and no anchoring artifacts', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/g3.uc', "print(uci.get('a', 'b', 'c'));\n");
    expect(msgs(ar).filter((m) => /does not exist/.test(m))).toEqual([]);
  });
  test('G4 openMembers objects (http) never claim unknown members', () => {
    const { ar } = analyzeAt('applications/luci-app-c/ucode/controller/g4.uc', 'print(http.custom_extension_fn());\n');
    expect(msgs(ar).filter((m) => /does not exist/.test(m))).toEqual([]);
  });
});
