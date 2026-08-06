// LuCI template runtime support (0.8.0) — docs/luci-template-runtime-support.md.
//
// Part A: the dispatcher/runtime env ambient (`_`, `N_`, `entityencode`, `striptags`,
//         `http`, `ubus`, `uci`, `ctx`, `version`, `config`, `dispatcher`, `media`,
//         `theme`, `resource`, `pkgs_update_time`) is seeded in LuCI templates (.ut) and
//         controllers (…/ucode/controller/*.uc) — and ONLY there: detection demands the
//         tree actually contain luci-base's dispatcher.uc (evidence-based sniff).
// Part B: `include('name')` resolves against the workspace's ucode/template/ roots with
//         `.ut` appended (runtime.uc render_any), luci-base root first.
// Part C: `include('name', SCOPE)` sites feed the target template's injected scope, with
//         bare-identifier scopes mined from same-file evidence (declarator inits, member
//         assigns, call-site object literals incl. ONE callback indirection — the
//         luci-app-commands execute_command(return_html, …) → callback({…}) shape).
//
// All fixtures build a synthetic LuCI checkout in a UNIQUE temp dir (mkdtemp — no
// cross-run collisions) and tear it down after.

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
  resolveLuciModulePath, resolveLuciTemplatePattern, clearLuciWorkspaceCache,
} from '../../src/analysis/luciEnv.ts';
import { handleHover } from '../../src/hover.ts';
import { handleDefinition } from '../../src/definition.ts';

let root; // the synthetic checkout

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-rt-'));
  const put = (rel, content) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  };
  put('modules/luci-base/ucode/dispatcher.uc', '// luci-base dispatcher stub\n');
  put('modules/luci-base/ucode/template/header.ut', '<html>{% let hdr = 1; %}\n');
  put('modules/luci-base/ucode/template/footer.ut', '</html>\n');
  put('themes/luci-theme-demo/ucode/template/header.ut', '<html class="theme">\n');
  put('applications/luci-app-demo/ucode/template/page.ut', '{% print(exitcode); %}\n');
  put('applications/luci-app-demo/ucode/controller/demo.uc', '// controller stub\n');
  clearLuciWorkspaceCache();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  clearLuciWorkspaceCache();
});

function mkDoc(code, uri) {
  return {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else c++; } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri, languageId: 'ucode', version: 1,
  };
}

function parseSrc(code) {
  const isT = detectTemplateMode(code);
  const lx = new UcodeLexer(code, { rawMode: !isT });
  const tokens = isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize();
  return new UcodeParser(tokens, code).parse().ast;
}

/** Analyze `code` as if it lived at `rel` inside the synthetic checkout. */
function analyzeAt(rel, code) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, code);
  const doc = mkDoc(code, 'file://' + p);
  const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
    .analyze(parseSrc(code));
  return { doc, ar, filePath: p };
}

const errors = (ar) => ar.diagnostics.filter((d) => d.severity === 1).map((d) => d.message);
const all = (ar) => ar.diagnostics.map((d) => d.message);

// ── detection (luciEnv.ts) ──────────────────────────────────────────────────────────────

describe('LuCI workspace detection', () => {
  test('finds a checkout root from a nested template path', () => {
    const ws = findLuciWorkspace(path.join(root, 'applications/luci-app-demo/ucode/template/page.ut'));
    expect(ws).toEqual({ root, kind: 'checkout' });
  });

  test('finds a deployed layout (dispatcher.uc + runtime.uc + template/ in one dir)', () => {
    const dep = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-dep-'));
    fs.mkdirSync(path.join(dep, 'luci/template'), { recursive: true });
    fs.writeFileSync(path.join(dep, 'luci/dispatcher.uc'), '//\n');
    fs.writeFileSync(path.join(dep, 'luci/runtime.uc'), '//\n');
    fs.writeFileSync(path.join(dep, 'luci/template/header.ut'), '<html>\n');
    clearLuciWorkspaceCache();
    const ws = findLuciWorkspace(path.join(dep, 'luci/template/header.ut'));
    expect(ws).toEqual({ root: path.join(dep, 'luci'), kind: 'deployed' });
    expect(resolveLuciTemplatePath(path.join(dep, 'luci/template/x.ut'), 'header'))
      .toBe(path.join(dep, 'luci/template/header.ut'));
    fs.rmSync(dep, { recursive: true, force: true });
    clearLuciWorkspaceCache();
  });

  test('a .ut outside any LuCI tree is NOT a LuCI env file', () => {
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'not-luci-'));
    fs.writeFileSync(path.join(stray, 'page.ut'), '{% print(1); %}\n');
    expect(isLuciEnvFile(path.join(stray, 'page.ut'))).toBeNull();
    fs.rmSync(stray, { recursive: true, force: true });
  });

  test('controllers are env files; ordinary luci-base modules are not', () => {
    expect(isLuciEnvFile(path.join(root, 'applications/luci-app-demo/ucode/controller/demo.uc'))).not.toBeNull();
    expect(isLuciEnvFile(path.join(root, 'modules/luci-base/ucode/dispatcher.uc'))).toBeNull();
  });

  test('template roots are priority-ordered: luci-base, then apps, then themes', () => {
    const roots = getLuciTemplateRoots({ root, kind: 'checkout' });
    expect(roots[0]).toBe(path.join(root, 'modules/luci-base/ucode/template'));
    const appIdx = roots.indexOf(path.join(root, 'applications/luci-app-demo/ucode/template'));
    const themeIdx = roots.indexOf(path.join(root, 'themes/luci-theme-demo/ucode/template'));
    expect(appIdx).toBeGreaterThan(0);
    expect(themeIdx).toBeGreaterThan(appIdx);
  });

  test("include('header') prefers the luci-base shim over the theme copy", () => {
    expect(resolveLuciTemplatePath(path.join(root, 'applications/luci-app-demo/ucode/template/page.ut'), 'header'))
      .toBe(path.join(root, 'modules/luci-base/ucode/template/header.ut'));
  });

  test('an explicit path-looking include name is NOT template-root resolved', () => {
    const from = path.join(root, 'applications/luci-app-demo/ucode/template/page.ut');
    expect(resolveLuciTemplatePath(from, '/etc/foo.uc')).toBeNull();
    expect(resolveLuciTemplatePath(from, 'header.ut')).toBeNull();
    expect(resolveLuciTemplatePath(from, 'child.uc')).toBeNull();
  });
});

// ── luci.* module imports (checkout ↔ /usr/share/ucode/luci mapping) ────────────────────

describe('luci.* dotted module resolution', () => {
  test("import from 'luci.http' resolves to luci-base's ucode/http.uc", () => {
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/http.uc'),
      'export function urldecode(s) { return s; };\n');
    clearLuciWorkspaceCache();
    const importer = path.join(root, 'applications/luci-app-demo/ucode/controller/demo.uc');
    expect(resolveLuciModulePath(importer, 'luci.http'))
      .toBe(path.join(root, 'modules/luci-base/ucode/http.uc'));
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/impmod.uc',
      `import { urldecode } from 'luci.http';\nprint(urldecode('a%20b'));\n`);
    expect(all(ar).filter((m) => /Cannot find module/.test(m))).toEqual([]);
  });

  test('a nested plugin module resolves through its own package ucode/ dir', () => {
    const p = path.join(root, 'plugins/luci-plugin-demo/ucode/plugins/auth/demo.uc');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'export function check() { return true; };\n');
    clearLuciWorkspaceCache();
    const importer = path.join(root, 'modules/luci-base/ucode/dispatcher.uc');
    expect(resolveLuciModulePath(importer, 'luci.plugins.auth.demo')).toBe(p);
  });

  test('outside a LuCI tree, luci.* stays unresolved (no false resolution)', () => {
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'stray-mod-'));
    expect(resolveLuciModulePath(path.join(stray, 'a.uc'), 'luci.http')).toBeNull();
    fs.rmSync(stray, { recursive: true, force: true });
  });

  test('non-luci dotted names are untouched', () => {
    const importer = path.join(root, 'applications/luci-app-demo/ucode/controller/demo.uc');
    expect(resolveLuciModulePath(importer, 'cli.utils')).toBeNull();
  });
});

// ── regressions surfaced by the luci corpus differential ────────────────────────────────

describe('corpus-differential regressions', () => {
  test("import { default as X } binds the module's default export (dispatcher.uc pattern)", () => {
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/runtime.uc'),
      'export default function(env) { return env; };\n');
    clearLuciWorkspaceCache();
    const { ar } = analyzeAt('modules/luci-base/ucode/defimp.uc',
      `import { default as LuCIRuntime } from 'luci.runtime';\nlet rt = LuCIRuntime({});\nprint(rt);\n`);
    expect(all(ar).filter((m) => /does not export|Undefined function/.test(m))).toEqual([]);
  });

  test("import { default as X } still flags when the module has NO default export", () => {
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/nodefault.uc'),
      'export function only_named() { return 1; };\n');
    clearLuciWorkspaceCache();
    const { ar } = analyzeAt('modules/luci-base/ucode/defimp2.uc',
      `import { default as X } from 'luci.nodefault';\nprint(X);\n`);
    expect(all(ar).some((m) => /does not export 'default'/.test(m))).toBe(true);
  });

  test('strict mode: a truthiness test of length(maybe-null) is not an error', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/lentest.uc',
      `'use strict';\nlet args;\nif (length(args = http.formvalue('args')))\n  print(args);\n`);
    expect(all(ar).filter((m) => /Argument 1 of length/.test(m))).toEqual([]);
  });

  test('strict mode: a VALUE use of length(maybe-null) still flags', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/lenval.uc',
      `'use strict';\nlet n = length(http.formvalue('args'));\nprint(n);\n`);
    expect(all(ar).some((m) => /Argument 1 of length\(\) may be null/.test(m))).toBe(true);
  });

  test('a pure-HTML .ut (no template tag at all) is template mode, and a healthy include target', () => {
    // Legal utpl: everything outside tags is literal output — a tagless file is all output.
    // The content sniff can't see that; the .ut extension decides.
    expect(detectTemplateModeForFile('file:///x/footer.ut', '</body></html>\n')).toBe(true);
    expect(detectTemplateModeForFile('file:///x/footer.uc', '</body></html>\n')).toBe(false);
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/template/plain.ut'), '<hr>\n');
    clearLuciWorkspaceCache();
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/incplain.ut',
      `{% include('plain'); %}`);
    // Neither "Cannot find" nor the false "could not be parsed" error may appear.
    expect(all(ar).filter((m) => /Cannot find|could not be parsed/.test(m))).toEqual([]);
  });
});

// ── standalone (out-of-tree) LuCI packages — layouts copied from REAL repos ─────────────
// jerrykuku/luci-theme-argon:  Makefile (LUCI_TITLE + include $(TOPDIR)/feeds/luci/luci.mk)
//                              + ucode/template/themes/argon/*.ut at repo root.
// sbwml/luci-app-bluetooth:    Makefile (same form) + root/usr/share/rpcd/ucode/*.uc.
// i-love-luci:                 a FEED repo — applications/<pkg>/{Makefile,ucode/template/…}.

describe('standalone LuCI package detection', () => {
  const LUCI_MAKEFILE = 'include $(TOPDIR)/rules.mk\n\nLUCI_TITLE:=Test theme\nLUCI_DEPENDS:=+luci-base\n\ninclude $(TOPDIR)/feeds/luci/luci.mk\n';

  function mkPkg(layout) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-pkg-'));
    for (const [rel, content] of Object.entries(layout)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    clearLuciWorkspaceCache();
    return dir;
  }
  function analyzeFile(p) {
    const code = fs.readFileSync(p, 'utf8');
    const doc = mkDoc(code, 'file://' + p);
    const isT = detectTemplateModeForFile(p, code);
    const lx = new UcodeLexer(code, { rawMode: !isT });
    const tokens = isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize();
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
      .analyze(new UcodeParser(tokens, code).parse().ast);
    return { doc, ar };
  }

  test('argon-shape theme repo: env ambient works, no bogus not-found claims', () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/themes/argon/header.ut':
        `<html>{% http.prepare_content('text/html'); print(entityencode(theme), media, resource, dispatcher.build_url('admin')); %}`,
    });
    const ws = findLuciWorkspace(path.join(dir, 'ucode/template/themes/argon/header.ut'));
    expect(ws).toEqual({ root: dir, kind: 'package' });
    const { ar } = analyzeFile(path.join(dir, 'ucode/template/themes/argon/header.ut'));
    expect(all(ar).filter((m) => /Undefined|Cannot find/.test(m))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a standalone package's luci.* import is not flagged (luci-base lives on the device)", () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/x.ut': `{% print(1); %}`,
      'root/usr/share/rpcd/ucode/backend.uc':
        `'use strict';\nimport { urldecode } from 'luci.http';\nreturn { demo: { call: function() { return urldecode('a%20b'); } } };\n`,
    });
    const { ar } = analyzeFile(path.join(dir, 'root/usr/share/rpcd/ucode/backend.uc'));
    expect(all(ar).filter((m) => /Cannot find module/.test(m))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("include('header') in a standalone package is not claimed missing (merged dir on device)", () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/page.ut': `{% include('header', { blank_page: true }); %}<p>x</p>{% include('footer'); %}`,
    });
    const { ar } = analyzeFile(path.join(dir, 'ucode/template/page.ut'));
    expect(all(ar).filter((m) => /Cannot find/.test(m))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a package's OWN template still resolves (its ucode/ dir is a runtime slice)", () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/app/main.ut': `{% include('app/partial'); %}`,
      'ucode/template/app/partial.ut': `<hr>\n`,
    });
    expect(resolveLuciTemplatePath(path.join(dir, 'ucode/template/app/main.ut'), 'app/partial'))
      .toBe(path.join(dir, 'ucode/template/app/partial.ut'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('feed-shape repo (applications/<pkg>/…) is detected at the package dir', () => {
    const dir = mkPkg({
      'applications/luci-app-demo/Makefile': LUCI_MAKEFILE,
      'applications/luci-app-demo/ucode/template/page.ut': `{% print(_('hi')); %}`,
    });
    const tpl = path.join(dir, 'applications/luci-app-demo/ucode/template/page.ut');
    expect(findLuciWorkspace(tpl)).toEqual({ root: path.join(dir, 'applications/luci-app-demo'), kind: 'package' });
    const { ar } = analyzeFile(tpl);
    expect(all(ar).filter((m) => /Undefined/.test(m))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('render-compat names (node/css/duser/…) are clean in a package THEME template', () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/themes/x/header.ut':
        `{% if (node?.css) print(css, node.title); %}`,
      'ucode/template/themes/x/sysauth.ut':
        `{% print(duser, fuser, auth_message, trigger_apply, rollback_token); %}`,
    });
    for (const rel of ['ucode/template/themes/x/header.ut', 'ucode/template/themes/x/sysauth.ut']) {
      const { ar } = analyzeFile(path.join(dir, rel));
      expect(all(ar).filter((m) => /Undefined/.test(m))).toEqual([]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('compat names do NOT leak into controllers — typo detection stays', () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/x.ut': `{% print(1); %}`,
      'ucode/controller/c.uc': `print(node, css);\n`,
    });
    const { ar } = analyzeFile(path.join(dir, 'ucode/controller/c.uc'));
    expect(all(ar).filter((m) => /Undefined variable/.test(m)).length).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an arbitrary unknown name in a package template still flags (no blanket suppression)', () => {
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/template/t.ut': `{% print(totally_made_up_name); %}`,
    });
    const { ar } = analyzeFile(path.join(dir, 'ucode/template/t.ut'));
    expect(all(ar).some((m) => /Undefined variable: totally_made_up_name/.test(m))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a nested loop-local of an env name does not disable the ambient (uci.uc shape)', () => {
    // Real shape from /usr/share/ucode/luci/controller/admin/uci.uc: module-level reads
    // of the env `config` coexist with `for (let config in …)` loop locals in functions.
    const dir = mkPkg({
      'Makefile': LUCI_MAKEFILE,
      'ucode/controller/mixed.uc': [
        'function apply_timeout() {',
        '  return +(config?.apply?.rollback ?? 90) || 0;',   // env `config`
        '}',
        'function commit_all(changes) {',
        '  for (let config in changes) print(config);',      // loop-local shadow
        '}',
        'print(apply_timeout(), commit_all([]));',
      ].join('\n') + '\n',
    });
    const { ar } = analyzeFile(path.join(dir, 'ucode/controller/mixed.uc'));
    expect(all(ar).filter((m) => /Undefined variable: config/.test(m))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('deployed layout: nested controllers (controller/admin/*.uc) get the env', () => {
    const dep = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-depn-'));
    for (const rel of ['dispatcher.uc', 'runtime.uc']) {
      fs.mkdirSync(path.join(dep, 'luci'), { recursive: true });
      fs.writeFileSync(path.join(dep, 'luci', rel), '//\n');
    }
    fs.mkdirSync(path.join(dep, 'luci/template'), { recursive: true });
    fs.mkdirSync(path.join(dep, 'luci/controller/admin'), { recursive: true });
    const nested = path.join(dep, 'luci/controller/admin/uci.uc');
    fs.writeFileSync(nested, 'http.write("x");\n');
    clearLuciWorkspaceCache();
    expect(isLuciEnvFile(nested)?.ws.kind).toBe('deployed');
    fs.rmSync(dep, { recursive: true, force: true });
    clearLuciWorkspaceCache();
  });

  test("a missing .ut with a Lua view fallback (<pkg>/luasrc/view/<name>.htm) is not flagged", () => {
    // render_any falls back to the Lua runtime's .htm view — the shipped example is
    // admin_status/luaindex (luci-lua-runtime/luasrc/view/admin_status/luaindex.htm).
    fs.mkdirSync(path.join(root, 'modules/luci-lua-runtime/luasrc/view/admin_status'), { recursive: true });
    fs.writeFileSync(path.join(root, 'modules/luci-lua-runtime/luasrc/view/admin_status/luaindex.htm'), '<html>\n');
    clearLuciWorkspaceCache();
    const { ar } = analyzeAt('modules/luci-base/ucode/template/luafall.ut',
      `{% include('admin_status/luaindex'); include('definitely_absent_everywhere'); %}`);
    const notFound = all(ar).filter((m) => /Cannot find/.test(m));
    expect(notFound.length).toBe(1); // only the genuinely absent one
    expect(notFound[0]).toContain('definitely_absent_everywhere');
  });

  test('CACHE: a package verdict never leaks to sibling trees via shared ancestors', () => {
    // Regression (grand-tour build, 2026-08-05): the package ascent kept climbing past
    // the package root looking for a checkout, then cached the package verdict on the
    // ancestors it passed — so a SIBLING tree under the same parent inherited LuCI
    // context for the TTL. Resolve the package FIRST (warm the cache), then check the
    // sibling still resolves to nothing.
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'luci-sib-'));
    const pkgTpl = path.join(parent, 'my-theme/ucode/template/x.ut');
    fs.mkdirSync(path.dirname(pkgTpl), { recursive: true });
    fs.writeFileSync(path.join(parent, 'my-theme/Makefile'), LUCI_MAKEFILE);
    fs.writeFileSync(pkgTpl, '{% print(1); %}');
    const stray = path.join(parent, 'unrelated/orphan.ut');
    fs.mkdirSync(path.dirname(stray), { recursive: true });
    fs.writeFileSync(stray, '{% print(theme); %}');
    clearLuciWorkspaceCache();
    expect(findLuciWorkspace(pkgTpl)?.kind).toBe('package'); // warms ancestor cache
    expect(findLuciWorkspace(stray)).toBeNull();             // sibling must NOT inherit
    fs.rmSync(parent, { recursive: true, force: true });
    clearLuciWorkspaceCache();
  });

  test('a plain (non-LuCI) OpenWrt package Makefile does NOT create LuCI context', () => {
    const dir = mkPkg({
      'Makefile': 'include $(TOPDIR)/rules.mk\n\nPKG_NAME:=plain-pkg\n\ninclude $(INCLUDE_DIR)/package.mk\n',
      'files/script.ut': `{% print(entityencode(theme)); %}`,
    });
    expect(findLuciWorkspace(path.join(dir, 'files/script.ut'))).toBeNull();
    const { ar } = analyzeFile(path.join(dir, 'files/script.ut'));
    expect(all(ar).some((m) => /Undefined (variable|function)/.test(m))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the full checkout still wins over an in-tree package Makefile', () => {
    // In the synthetic checkout, apps have LuCI Makefiles too — the ascent must keep
    // going to the checkout root (which sees ALL template roots, not one package's).
    fs.writeFileSync(path.join(root, 'applications/luci-app-demo/Makefile'), LUCI_MAKEFILE);
    clearLuciWorkspaceCache();
    const ws = findLuciWorkspace(path.join(root, 'applications/luci-app-demo/ucode/template/page.ut'));
    expect(ws).toEqual({ root, kind: 'checkout' });
  });

  test('unresolvable luci.* in a FULL checkout is silent too (core.so / generated version.uc)', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/native.uc',
      `import { load_catalog } from 'luci.core';\nload_catalog('en');\n`);
    expect(all(ar).filter((m) => /Cannot find module/.test(m))).toEqual([]);
  });
});

// ── diagnostic anchoring + template-safe @global (grand-tour feedback) ──────────────────

describe('member-error anchoring and template @global', () => {
  test("an unknown uci.cursor member anchors on the MEMBER id only, not `uci.member`", () => {
    const code = `let sections = uci.get_all_sectionz('mega');\nprint(sections);\n`;
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/anchor.uc', code);
    const d = ar.diagnostics.find((x) => /get_all_sectionz/.test(x.message));
    expect(d).toBeTruthy();
    // Anchored on the member id alone: cols 19..35 of line 0 — NOT col 15 (`uci.`).
    expect(d.range.start.character).toBe(code.indexOf('get_all_sectionz'));
    expect(d.range.end.character).toBe(code.indexOf('get_all_sectionz') + 'get_all_sectionz'.length);
  });

  test('a `{% /** @global x */ %}`-wrapped declaration silences UC1001 in a plain template', () => {
    // The template-aware quick-fix form: zero page output (oracle-verified), and the
    // raw-text @global scan still honors it. No LuCI context here — plain .ut.
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-global-'));
    const p = path.join(stray, 'page.ut');
    const code = `{% /** @global theme */ %}\n<p>{{ theme }}</p>\n`;
    fs.writeFileSync(p, code);
    const doc = mkDoc(code, 'file://' + p);
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
      .analyze(parseSrc(code));
    expect(all(ar).filter((m) => /Undefined variable: theme/.test(m))).toEqual([]);
    fs.rmSync(stray, { recursive: true, force: true });
  });
});

// ── Part A: env ambient ─────────────────────────────────────────────────────────────────

describe('LuCI env ambient (Part A)', () => {
  test('a LuCI template resolves the whole env set without diagnostics', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/env.ut', `{%
      print(_('hi'), N_(1, 'a', 'b'), entityencode(theme), striptags(resource));
      print(http.getenv('PATH_INFO'), uci.get('luci', 'main', 'lang'), dispatcher.build_url('x'));
      print(ctx, version, config, media, pkgs_update_time);
      ubus.call('service', 'list');
    %}`);
    expect(errors(ar)).toEqual([]);
  });

  test('a LuCI controller (.uc under ucode/controller/) gets the env too', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/env.uc',
      `http.prepare_content('application/json');\nhttp.write_json({ ok: true });\n`);
    expect(errors(ar)).toEqual([]);
  });

  test('the SAME code outside a LuCI tree keeps its UC1001s', () => {
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'stray-ut-'));
    const p = path.join(stray, 'env.ut');
    const code = `{% print(_('hi'), entityencode(theme)); %}`;
    fs.writeFileSync(p, code);
    const doc = mkDoc(code, 'file://' + p);
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
      .analyze(parseSrc(code));
    expect(all(ar).some((m) => /Undefined (variable|function)/.test(m))).toBe(true);
    fs.rmSync(stray, { recursive: true, force: true });
  });

  test('_() returns a definite string (feeds sprintf cleanly)', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/tr.ut',
      `{% let translated = _('Command executed'); print(sprintf(_('%d ok'), 1)); %}`);
    expect(errors(ar)).toEqual([]);
    const sym = ar.symbolTable.resolveReference('translated', 30);
    expect(sym).toBeTruthy();
  });

  test('http members type-check: known member ok, hover shows luci.http method type', () => {
    const code = `{% let pathinfo = http.getenv('PATH_INFO'); %}`;
    const { doc, ar } = analyzeAt('applications/luci-app-demo/ucode/template/http.ut', code);
    expect(errors(ar)).toEqual([]);
    const col = code.indexOf('getenv') + 1;
    const h = handleHover({ textDocument: { uri: doc.uri }, position: { line: 0, character: col } }, { get: () => doc }, ar);
    const text = h && h.contents ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '') : '';
    expect(text).toContain('getenv');
  });

  test('http is openMembers: an unknown member is not a UC5004 hard error', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/open.ut',
      `{% http.some_runtime_extension(); %}`);
    expect(errors(ar)).toEqual([]);
  });

  test("a file's own binding of an env name wins (no ambient override)", () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/own.uc',
      `let http = 42;\nlet doubled = http * 2;\nprint(doubled);\n`);
    expect(errors(ar)).toEqual([]); // integer math on the USER's http — ambient would break this
  });

  test('an imported env name wins (dispatcher.uc pattern: import { striptags })', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/imp.uc',
      `import { striptags } from 'html';\nprint(striptags('<b>x</b>'));\n`);
    expect(errors(ar)).toEqual([]);
  });

  test('env names are not flagged unused and do not leak into non-LuCI analyses', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/quiet.ut', `{% print(1); %}`);
    expect(all(ar).filter((m) => /never used/i.test(m))).toEqual([]);
  });
});

// ── go-to-definition on env members / ambient names ─────────────────────────────────────

describe('go-to-definition for the env ambient', () => {
  const defAt = (doc, ar, line, character) => handleDefinition(
    { textDocument: { uri: doc.uri }, position: { line, character } },
    { get: (u) => (u === doc.uri ? doc : undefined) },
    new Map([[doc.uri, ar]]),
  );

  test('http.formvalue jumps into luci-base http.uc at the formvalue property', () => {
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/http.uc'),
      'const proto = {\n\tformvalue: function(name) { return name; },\n};\nexport function urldecode(s) { return s; };\n');
    clearLuciWorkspaceCache();
    const code = `let v = http.formvalue('q');\nprint(v);\n`;
    const { doc, ar } = analyzeAt('applications/luci-app-demo/ucode/controller/gtd.uc', code);
    const def = defAt(doc, ar, 0, code.indexOf('formvalue') + 2);
    expect(def).toBeTruthy();
    expect(def.uri.endsWith('modules/luci-base/ucode/http.uc')).toBe(true);
    expect(def.range.start.line).toBe(1); // the `formvalue:` property, not the file top
  });

  test('an ambient base name never fabricates a row-1 location', () => {
    const code = `print(theme);\n`;
    const { doc, ar } = analyzeAt('applications/luci-app-demo/ucode/controller/gtd2.uc', code);
    const def = defAt(doc, ar, 0, code.indexOf('theme') + 2);
    expect(def).toBeNull();
  });

  test("go-to-definition on include('header') opens the luci-base shim", () => {
    const code = `{% include('header'); %}`;
    const { doc, ar } = analyzeAt('applications/luci-app-demo/ucode/template/gtd3.ut', code);
    const def = defAt(doc, ar, 0, code.indexOf('header') + 2);
    expect(def).toBeTruthy();
    expect(def.uri.endsWith('modules/luci-base/ucode/template/header.ut')).toBe(true);
  });
});

// ── Part B: template-root include resolution ────────────────────────────────────────────

describe('template-root include resolution (Part B)', () => {
  test("include('header') / include('footer') produce no UC3002 in a LuCI template", () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/inc.ut',
      `{% include('header', { blank_page: true }); %}<p>body</p>{% include('footer', { blank_page: true }); %}`);
    expect(all(ar).filter((m) => /Cannot find/.test(m))).toEqual([]);
  });

  test('a MISSING template still flags — with the template-directory story', () => {
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/template/miss.ut',
      `{% include('no_such_template'); %}`);
    const msgs = all(ar).filter((m) => /Cannot find template 'no_such_template'/.test(m));
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain("ucode/template/");
    expect(msgs[0]).toContain('no_such_template.ut');
  });

  test('file-relative includes in LuCI files still work (real path with extension)', () => {
    analyzeAt('applications/luci-app-demo/ucode/controller/sibling.uc', `x = 1;\n`);
    const { ar } = analyzeAt('applications/luci-app-demo/ucode/controller/rel.uc',
      `include('sibling.uc');\nprint(x);\n`);
    expect(all(ar).filter((m) => /Cannot find/.test(m))).toEqual([]);
  });

  test('outside LuCI context the message keeps the file-relative story', () => {
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'stray-inc-'));
    const p = path.join(stray, 'a.uc');
    const code = `include('missing.uc');\n`;
    fs.writeFileSync(p, code);
    const doc = mkDoc(code, 'file://' + p);
    const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
      .analyze(parseSrc(code));
    const msgs = all(ar).filter((m) => /Cannot find include target/.test(m));
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain('resolved relative to this file');
    fs.rmSync(stray, { recursive: true, force: true });
  });
});

// ── Part C: per-render scope inference ──────────────────────────────────────────────────

describe('per-render scope inference (Part C)', () => {
  const parseFile = (p) => parseSrc(fs.readFileSync(p, 'utf8'));
  const luciResolve = (raw, includer) => resolveLuciTemplatePath(includer, raw);

  test('an object-literal scope reaches the template through the template-root index', () => {
    const ctl = path.join(root, 'applications/luci-app-demo/ucode/controller/lit.uc');
    fs.writeFileSync(ctl, `include('page', { exitcode: 0, stdout: "s" });\n`);
    const tpl = path.join(root, 'applications/luci-app-demo/ucode/template/page.ut');
    const index = buildIncludeScopeIndex(
      [{ path: ctl, ast: parseFile(ctl) }, { path: tpl, ast: parseFile(tpl) }],
      { resolveTargetPath: luciResolve },
    );
    const entry = index.get(tpl);
    expect(entry).toBeTruthy();
    expect([...entry.injectedNames].sort()).toEqual(['exitcode', 'stdout']);
    expect(entry.injectedTypes.get('exitcode')).toBe('integer');
  });

  test('the luci-app-commands shape: identifier scope mined through ONE callback hop', () => {
    const ctl = path.join(root, 'applications/luci-app-demo/ucode/controller/cb.uc');
    fs.writeFileSync(ctl, `
function execute_command(callback, id) {
  if (id) callback({ ok: true, stdout: "s", stderr: "e", exitcode: 0, binary: false });
  else callback({ ok: false, code: 404, reason: "no" });
}
function return_html(result) {
  if (result.ok) include('page', result);
}
execute_command(return_html, 'x');
`);
    const tpl = path.join(root, 'applications/luci-app-demo/ucode/template/page.ut');
    const index = buildIncludeScopeIndex(
      [{ path: ctl, ast: parseFile(ctl) }, { path: tpl, ast: parseFile(tpl) }],
      { resolveTargetPath: luciResolve },
    );
    const entry = index.get(tpl);
    expect(entry).toBeTruthy();
    expect([...entry.injectedNames].sort()).toEqual(['binary', 'code', 'exitcode', 'ok', 'reason', 'stderr', 'stdout']);
    expect(entry.complete).toBe(false); // mined identifier scopes are never exhaustive
    expect(entry.injectedTypes.get('exitcode')).toBe('integer');
    expect(entry.injectedTypes.get('stdout')).toBe('string');
  });

  test('identifier scope from a declarator init + later member assigns', () => {
    const ast = parseSrc(`
let scope = { a: 1 };
scope.b = "two";
scope["c"] = true;
include('page', scope);
`);
    const [site] = extractIncludeSites(ast);
    expect(site.hasScope).toBe(true);
    expect(site.hasDynamicScope).toBe(true);
    expect(site.scopeKeys.sort()).toEqual(['a', 'b', 'c']);
    expect(site.scopeValues.b).toEqual({ kind: 'type', type: 'string' });
  });

  test('conflicting mined value types degrade to unknown, keys survive', () => {
    const ast = parseSrc(`
function f(res) { include('page', res); }
f({ x: 1 });
f({ x: "s" });
`);
    const [site] = extractIncludeSites(ast);
    expect(site.scopeKeys).toEqual(['x']);
    expect(site.scopeValues.x).toEqual({ kind: 'unknown' });
  });

  test('an unmineable identifier scope still counts as dynamic scope (no keys)', () => {
    const ast = parseSrc(`function f(res) { include('page', res); }\n`);
    const [site] = extractIncludeSites(ast);
    expect(site.hasScope).toBe(true);
    expect(site.hasDynamicScope).toBe(true);
    expect(site.scopeKeys).toEqual([]);
  });

  test('checkIncludeScopes SKIPS template-root sites (no bogus missing-variable claims)', () => {
    const ctl = path.join(root, 'applications/luci-app-demo/ucode/controller/enforce.uc');
    const code = `include('page', { unrelated: 1 });\n`;
    fs.writeFileSync(ctl, code);
    // page.ut freely uses `exitcode`, which this scope does not provide — but the template
    // also receives the env chain + other includers' scopes, so no claim is sound here.
    const diags = checkIncludeScopes(
      parseSrc(code), ctl,
      () => new Set(['exitcode']), () => false, undefined,
      luciResolve,
    );
    expect(diags).toEqual([]);
  });

  test("runtime.render('name', {…}) member calls feed the target like include()", () => {
    const ctl = path.join(root, 'applications/luci-app-demo/ucode/controller/rend.uc');
    fs.writeFileSync(ctl, `function go(runtime) { runtime.render('page', { exitcode: 1 }); }\n`);
    const tpl = path.join(root, 'applications/luci-app-demo/ucode/template/page.ut');
    const index = buildIncludeScopeIndex(
      [{ path: ctl, ast: parseFile(ctl) }, { path: tpl, ast: parseFile(tpl) }],
      { resolveTargetPath: luciResolve },
    );
    expect([...(index.get(tpl)?.injectedNames ?? [])]).toEqual(['exitcode']);
  });

  test('a template-literal path becomes a pattern reaching EVERY theme copy', () => {
    fs.mkdirSync(path.join(root, 'themes/luci-theme-zzz2/ucode/template/themes/zzz2'), { recursive: true });
    fs.writeFileSync(path.join(root, 'themes/luci-theme-zzz2/ucode/template/themes/zzz2/sysauth.ut'), '{% print(duser); %}\n');
    fs.mkdirSync(path.join(root, 'themes/luci-theme-demo/ucode/template/themes/demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'themes/luci-theme-demo/ucode/template/themes/demo/sysauth.ut'), '{% print(duser); %}\n');
    clearLuciWorkspaceCache();
    const disp = path.join(root, 'modules/luci-base/ucode/render_theme.uc');
    // The dispatcher.uc shape: the SAME path template declared in two sibling blocks
    // (agreeing declarators), rendered via a member call with an identifier scope.
    fs.writeFileSync(disp, `
function a(runtime, media) {
  let theme_sysauth = \`themes/\${media}/sysauth\`;
  let scope = { duser: 'root' };
  return runtime.render(theme_sysauth, scope);
}
function b(runtime, media) {
  let theme_sysauth = \`themes/\${media}/sysauth\`;
  let scope = { duser: 'root' };
  return runtime.render(theme_sysauth, scope);
}
`);
    const entries = [disp].map((p) => ({ path: p, ast: parseFile(p) }));
    const index = buildIncludeScopeIndex(entries, {
      resolveTargetPath: luciResolve,
      resolveTargetPattern: (pat, inc) => resolveLuciTemplatePattern(inc, pat),
    });
    const t1 = path.join(root, 'themes/luci-theme-zzz2/ucode/template/themes/zzz2/sysauth.ut');
    const t2 = path.join(root, 'themes/luci-theme-demo/ucode/template/themes/demo/sysauth.ut');
    expect([...(index.get(t1)?.injectedNames ?? [])]).toEqual(['duser']);
    expect([...(index.get(t2)?.injectedNames ?? [])]).toEqual(['duser']);
  });

  test("a BARE include is still an edge: the includer's injected scope leaks through it", () => {
    // app.uc → include('mid', {leaked: 1}); mid.ut → bare include('leaf'); leaf sees `leaked`.
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/template/mid.ut'), `{% include('leaf'); %}\n`);
    fs.writeFileSync(path.join(root, 'modules/luci-base/ucode/template/leaf.ut'), `{% print(leaked); %}\n`);
    clearLuciWorkspaceCache();
    const ctl = path.join(root, 'applications/luci-app-demo/ucode/controller/chain.uc');
    fs.writeFileSync(ctl, `include('mid', { leaked: 1 });\n`);
    const files = [ctl, path.join(root, 'modules/luci-base/ucode/template/mid.ut')];
    const index = buildIncludeScopeIndex(files.map((p) => ({ path: p, ast: parseFile(p) })), { resolveTargetPath: luciResolve });
    const leaf = path.join(root, 'modules/luci-base/ucode/template/leaf.ut');
    expect([...(index.get(leaf)?.injectedNames ?? [])]).toEqual(['leaked']);
  });

  test('DISAGREEING path declarators are not guessed', () => {
    const ast = parseSrc(`
function a(r) { let p = 'one'; r.render(p, { x: 1 }); }
function b() { let p = 'two'; }
`);
    // `p` resolves to 'one' in one declarator and 'two' in another → no site.
    expect(extractIncludeSites(ast)).toEqual([]);
  });

  test('file-relative enforcement is unchanged for non-template includes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-enf-'));
    const inc = path.join(dir, 'main.uc');
    const code = `include('child.uc', { provided: 1 });\n`;
    fs.writeFileSync(inc, code);
    const diags = checkIncludeScopes(
      parseSrc(code), inc,
      () => new Set(['needed']), () => false, undefined,
      luciResolve,
    );
    expect(diags.length).toBe(1);
    expect(diags[0].missing).toEqual(['needed']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
