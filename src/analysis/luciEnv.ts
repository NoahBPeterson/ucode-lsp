/**
 * LuCI workspace detection + template-root include resolution.
 *
 * LuCI's ucode runtime (luci-base ucode/runtime.uc) resolves template includes against a
 * template DIRECTORY, not the including file: `render_any(path)` loads
 * `${template_directory}/${path}.ut` where `template_directory` is
 * `/usr/share/ucode/luci/template` on a device. In a LuCI source checkout that directory is
 * assembled at package build time from every `…/ucode/template/` mirror root (luci-base has
 * header.ut/footer.ut; apps and themes install their own trees). And inside a template or
 * controller, `include` IS that root-based function — runtime.uc:
 * `self.env.include = (...args) => self.render_any(...args)` — so the builtin's
 * file-relative model is factually wrong for these files.
 *
 * This module answers three questions, filesystem-backed and cached:
 *   1. Is this file part of a LuCI tree at all (checkout or deployed image)?
 *   2. Which files run under the LuCI env scope (templates + controllers)?
 *   3. Where does `include('name')` resolve to (priority-ordered template roots)?
 *
 * Detection is EVIDENCE-based, not name-based: we only claim LuCI context when the tree
 * actually contains luci-base's dispatcher.uc/runtime.uc — a stray `.ut` file outside a
 * LuCI tree keeps plain behavior (no ambient env, no template-root resolution).
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LuciWorkspace {
  /** The anchoring directory: a source checkout root (contains modules/luci-base/ucode/
   *  dispatcher.uc), a deployed runtime dir (dispatcher.uc + template/ directly, e.g.
   *  /usr/share/ucode/luci), or a STANDALONE LuCI package (a dir whose Makefile includes
   *  luci.mk / sets LUCI_TITLE — the out-of-tree convention every real third-party
   *  package follows: sbwml/luci-app-bluetooth, jerrykuku/luci-theme-argon, feed repos
   *  with applications/<pkg>/). */
  root: string;
  kind: 'checkout' | 'deployed' | 'package';
}

/** How many ancestor directories to probe before giving up. A LuCI checkout nests templates
 *  4 deep (applications/<app>/ucode/template); 10 leaves generous headroom for monorepos. */
const MAX_ASCENT = 10;

// Per-directory verdict cache. Directory STRUCTURE (does a dispatcher.uc exist above me?)
// changes far more rarely than file contents, so entries live for the process with a TTL
// backstop; tests reset via clearLuciWorkspaceCache().
const wsCache = new Map<string, { ws: LuciWorkspace | null; at: number }>();
const rootsCache = new Map<string, { roots: string[]; at: number }>();
const WS_TTL_MS = 30_000;

export function clearLuciWorkspaceCache(): void {
  wsCache.clear();
  rootsCache.clear();
  moduleNamesCache.clear();
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** Is `dir` a LuCI PACKAGE root — a Makefile that includes luci.mk or sets LUCI_TITLE?
 *  (The convention of luci.mk itself and of every real out-of-tree package/theme repo:
 *  `include $(TOPDIR)/feeds/luci/luci.mk` / `include ../../luci.mk` + `LUCI_TITLE:=`.)
 *  Bounded read: the signal always sits in the first couple of KB. */
function isLuciPackageDir(dir: string): boolean {
  const mk = path.join(dir, 'Makefile');
  if (!isFile(mk)) return false;
  let head = '';
  let fd: number | undefined;
  try {
    fd = fs.openSync(mk, 'r');
    const buf = Buffer.allocUnsafe(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    head = buf.toString('utf8', 0, n);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
  return /^\s*LUCI_TITLE\s*[:?]?=/m.test(head) || /^\s*include\s+\S*luci\.mk\s*$/m.test(head);
}

/** Locate the LuCI workspace containing `filePath` by walking up at most MAX_ASCENT levels. */
export function findLuciWorkspace(filePath: string): LuciWorkspace | null {
  const start = path.dirname(path.resolve(filePath));
  const now = Date.now();
  const cached = wsCache.get(start);
  if (cached && now - cached.at < WS_TTL_MS) return cached.ws;

  let ws: LuciWorkspace | null = null;
  // A standalone package Makefile seen on the way up. A FULL tree (checkout/deployed)
  // always wins — an in-tree app's own Makefile also matches, but the ascent continues
  // to the checkout root, which carries strictly more information.
  let packageHit: string | null = null;
  let reachedTop = false;
  const visited: string[] = [];
  let dir = start;
  for (let i = 0; i < MAX_ASCENT; i++) {
    visited.push(dir);
    const hit = wsCache.get(dir);
    if (hit && now - hit.at < WS_TTL_MS) { ws = hit.ws; break; }
    // Deployed layout: the runtime dir itself (dispatcher.uc + runtime.uc + template/).
    // CAVEAT: a checkout's modules/luci-base/ucode/ has the exact same shape — files
    // inside luci-base must still see the whole checkout (themes/apps template roots),
    // so that path re-anchors to the checkout root instead.
    if (isFile(path.join(dir, 'dispatcher.uc')) && isFile(path.join(dir, 'runtime.uc'))
        && isDir(path.join(dir, 'template'))) {
      const luciBaseSuffix = path.join('modules', 'luci-base', 'ucode');
      ws = dir.endsWith(path.sep + luciBaseSuffix)
        ? { root: dir.slice(0, -(path.sep + luciBaseSuffix).length), kind: 'checkout' }
        : { root: dir, kind: 'deployed' };
      break;
    }
    // Source checkout: the repo root, identified by luci-base's runtime files.
    if (isFile(path.join(dir, 'modules', 'luci-base', 'ucode', 'dispatcher.uc'))) {
      ws = { root: dir, kind: 'checkout' };
      break;
    }
    if (packageHit === null && isLuciPackageDir(dir)) packageHit = dir;
    const parent = path.dirname(dir);
    if (parent === dir) { reachedTop = true; break; }
    dir = parent;
  }
  if (ws === null && packageHit !== null) ws = { root: packageHit, kind: 'package' };
  // Cache ONLY dirs the verdict is actually valid for. A 'package' ascent keeps
  // climbing past the package dir (looking for a full checkout above), so `visited`
  // contains ancestors ABOVE the root — stamping the package verdict on those would
  // hand every sibling tree the wrong workspace for the TTL. A NULL verdict is valid
  // for every visited dir only when the walk hit the filesystem root; on MAX_ASCENT
  // exhaustion an ancestor's own (higher-reaching) window wasn't covered, so only the
  // starting dir may cache it.
  const cacheable = ws === null
    ? (reachedTop ? visited : visited.slice(0, 1))
    : visited.filter((d) => d === ws!.root || d.startsWith(ws!.root + path.sep));
  for (const d of cacheable) wsCache.set(d, { ws, at: now });
  return ws;
}

/**
 * Does this file execute under the LuCI env scope (ambient `http`/`uci`/`_`/… from
 * dispatcher.uc + runtime.uc)? True for any `.ut` template in a LuCI workspace and for
 * `…/ucode/controller/*.uc` controllers (dispatcher invokes those with the same env chain —
 * e.g. luci-app-commands' controller uses bare `http` and `include`).
 */
export function isLuciEnvFile(filePath: string): { ws: LuciWorkspace } | null {
  const p = path.resolve(filePath).split(path.sep).join('/');
  if (p.endsWith('.ut')) {
    const ws = findLuciWorkspace(filePath);
    return ws ? { ws } : null;
  }
  // Controllers live under `<pkg>/ucode/controller/` in source trees and under
  // `<runtime>/controller/` deployed (/usr/share/ucode/luci/controller/… on a device,
  // wherever a copied rootfs lands on a dev box) — and they NEST (controller/admin/*.uc
  // on a real 24.10 rootfs), so match any depth below the controller dir.
  if (!p.endsWith('.uc') || !p.includes('/controller/')) return null; // cheap gate
  const sourceStyle = /\/ucode\/controller\/.+\.uc$/.test(p);
  const ws = findLuciWorkspace(filePath);
  if (!ws) return null;
  if (sourceStyle) return { ws };
  // A generic /controller/ path counts only inside a DEPLOYED runtime dir's own tree.
  const rel = path.relative(ws.root, path.resolve(filePath)).split(path.sep).join('/');
  return ws.kind === 'deployed' && rel.startsWith('controller/') ? { ws } : null;
}

/**
 * Priority-ordered per-package `ucode/` dirs of a CHECKOUT — each one mirrors the deployed
 * `/usr/share/ucode/luci/` (luci-base's Makefile installs its ucode/* there; plugins ship
 * `ucode/plugins/…` = `/usr/share/ucode/luci/plugins/…`; apps their `ucode/template/`).
 * luci-base first, then other modules, applications, themes, plugins.
 */
function getLuciPackageUcodeDirs(ws: LuciWorkspace): string[] {
  const now = Date.now();
  const cached = rootsCache.get(ws.root);
  if (cached && now - cached.at < WS_TTL_MS) return cached.roots;

  const dirs: string[] = [];
  if (ws.kind === 'deployed') {
    dirs.push(ws.root); // the root IS /usr/share/ucode/luci
  } else if (ws.kind === 'package') {
    // A standalone package's `ucode/` dir installs into /usr/share/ucode/luci (luci.mk
    // UCODE_LIBRARYDIR) — it IS a slice of the merged runtime dir.
    const d = path.join(ws.root, 'ucode');
    if (isDir(d)) dirs.push(d);
  } else {
    const base = path.join(ws.root, 'modules', 'luci-base', 'ucode');
    if (isDir(base)) dirs.push(base);
    for (const group of ['modules', 'applications', 'themes', 'plugins']) {
      const groupDir = path.join(ws.root, group);
      let entries: string[] = [];
      try { entries = fs.readdirSync(groupDir); } catch { continue; }
      for (const name of entries.sort()) {
        const d = path.join(groupDir, name, 'ucode');
        if (d !== base && isDir(d)) dirs.push(d);
      }
    }
  }
  rootsCache.set(ws.root, { roots: dirs, at: now });
  return dirs;
}

/**
 * Priority-ordered template roots: each package ucode dir's `template/` subdir. luci-base
 * first (header/footer/error pages), then apps, then themes (per-theme header/footer
 * copies come last so `include('header')` prefers the luci-base shim, matching the
 * runtime's single merged directory where luci-base and the active theme provide them).
 */
export function getLuciTemplateRoots(ws: LuciWorkspace): string[] {
  return getLuciPackageUcodeDirs(ws).map((d) => path.join(d, 'template')).filter(isDir);
}

/**
 * Resolve a template-path PATTERN (`themes/*&#47;header` — from a template-literal include
 * like LuCI's theme-dispatch shim `include(`themes/${theme}/header`)`) to EVERY matching
 * template file across the workspace's template roots. `*` matches one path segment.
 * Used by the include-scope index so a scope fed through the shim reaches all theme
 * copies; returns [] outside LuCI context or when nothing matches.
 */
export function resolveLuciTemplatePattern(includerPath: string, pattern: string): string[] {
  if (pattern.startsWith('/') || !pattern.includes('*')) return [];
  const ws = findLuciWorkspace(includerPath);
  if (!ws) return [];
  const segs = pattern.split('/');
  const out: string[] = [];
  const matchFrom = (dir: string, i: number): void => {
    if (i === segs.length - 1) {
      const last = segs[i]!;
      if (last.includes('*')) {
        const re = new RegExp(`^${last.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}\\.ut$`);
        let names: string[] = [];
        try { names = fs.readdirSync(dir); } catch { return; }
        for (const n of names.sort()) if (re.test(n) && isFile(path.join(dir, n))) out.push(path.join(dir, n));
      } else {
        const cand = path.join(dir, `${last}.ut`);
        if (isFile(cand)) out.push(cand);
      }
      return;
    }
    const seg = segs[i]!;
    if (seg.includes('*')) {
      const re = new RegExp(`^${seg.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
      let names: string[] = [];
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const n of names.sort()) if (re.test(n) && isDir(path.join(dir, n))) matchFrom(path.join(dir, n), i + 1);
    } else {
      matchFrom(path.join(dir, seg), i + 1);
    }
  };
  for (const root of getLuciTemplateRoots(ws)) matchFrom(root, 0);
  return [...new Set(out)];
}

/**
 * Every `luci.*` module name THIS tree ships (dotted, without the `luci.` prefix):
 * the `*.uc` files under each package ucode dir, excluding `template/` and
 * `controller/` (those are render/dispatch artifacts, not importable modules).
 * Bounded depth, cached with the same TTL discipline as the roots.
 */
const moduleNamesCache = new Map<string, { names: string[]; at: number }>();
function listLuciShippedModuleNames(ws: LuciWorkspace): string[] {
  const now = Date.now();
  const cached = moduleNamesCache.get(ws.root);
  if (cached && now - cached.at < WS_TTL_MS) return cached.names;
  const names: string[] = [];
  for (const dir of getLuciPackageUcodeDirs(ws)) {
    const walk = (d: string, rel: string, depth: number): void => {
      if (depth > 3) return;
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (rel === '' && (e.name === 'template' || e.name === 'controller')) continue;
          walk(path.join(d, e.name), rel === '' ? e.name : `${rel}/${e.name}`, depth + 1);
        } else if (e.name.endsWith('.uc')) {
          const base = e.name.slice(0, -3);
          names.push((rel === '' ? base : `${rel}/${base}`).split('/').join('.'));
        }
      }
    };
    walk(dir, '', 0);
  }
  moduleNamesCache.set(ws.root, { names, at: now });
  return names;
}

/** Bounded Levenshtein (≤ maxDist, early exit) for typo suggestions. */
function editDistanceAtMost(a: string, b: string, maxDist: number): number | null {
  if (Math.abs(a.length - b.length) > maxDist) return null;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = prev[j]!;
      prev[j] = cur;
      if (cur < best) best = cur;
    }
    if (best > maxDist) return null;
  }
  return prev[b.length]! <= maxDist ? prev[b.length]! : null;
}

/**
 * Typo detector for the luci.* suppression: an unresolvable `luci.<x>` whose `<x>` is a
 * CLOSE match (edit distance ≤ 2) to a module THIS tree ships is almost certainly a
 * misspelling of the shipped one — the device-provided-module assumption doesn't apply
 * to names the repo itself owns. Returns the full suggested name or null.
 */
export function suggestLuciModuleName(importerPath: string, moduleName: string): string | null {
  if (!moduleName.startsWith('luci.')) return null;
  const ws = findLuciWorkspace(importerPath);
  if (!ws) return null;
  const target = moduleName.slice('luci.'.length);
  let best: { name: string; d: number } | null = null;
  for (const name of listLuciShippedModuleNames(ws)) {
    if (name === target) continue; // identical would have resolved
    const d = editDistanceAtMost(target, name, 2);
    if (d !== null && (best === null || d < best.d)) best = { name, d };
  }
  return best ? `luci.${best.name}` : null;
}

/**
 * Does `include('<name>')` / `render('<name>')` have a LUA-view fallback? runtime.uc's
 * render_any renders `${template_directory}/${name}.ut` when it exists and otherwise
 * falls back to the Lua runtime's view `<name>.htm` (render_lua via the luabridge) — so
 * a missing `.ut` with a present `.htm` is NOT a broken include. Lua views live at
 * `<pkg>/luasrc/view/` in source trees (luci.mk installs `luasrc`) and
 * `/usr/lib/lua/luci/view/` deployed.
 */
export function hasLuciLuaViewFallback(includerPath: string, name: string): boolean {
  if (name.startsWith('/') || name.includes('*')) return false;
  const ws = findLuciWorkspace(includerPath);
  if (!ws) return false;
  const rel = `${name}.htm`;
  if (ws.kind === 'deployed') {
    return isFile(path.join(ws.root, '..', '..', '..', 'lib', 'lua', 'luci', 'view', rel));
  }
  if (ws.kind === 'package') {
    return isFile(path.join(ws.root, 'luasrc', 'view', rel));
  }
  for (const group of ['modules', 'applications', 'themes', 'plugins']) {
    const groupDir = path.join(ws.root, group);
    let entries: string[] = [];
    try { entries = fs.readdirSync(groupDir); } catch { continue; }
    for (const pkg of entries) {
      if (isFile(path.join(groupDir, pkg, 'luasrc', 'view', rel))) return true;
    }
  }
  return false;
}

/**
 * Resolve a dotted `luci.<rest>` MODULE import (`import { urldecode } from 'luci.http'`)
 * inside a LuCI tree. Deployed, `/usr/share/ucode/luci/<rest>.uc` sits on ucode's real
 * search path; in a checkout that directory is assembled from every package's `ucode/`
 * dir, so the name resolves against each of them (luci-base first). Any file in the tree
 * may import these (controllers, rpcd backends, the runtime itself) — no env-file gate.
 * Returns an absolute path or null (→ caller falls through to the standard model).
 */
export function resolveLuciModulePath(importerPath: string, moduleName: string): string | null {
  if (!moduleName.startsWith('luci.')) return null;
  const ws = findLuciWorkspace(importerPath);
  if (!ws) return null;
  const rest = moduleName.slice('luci.'.length).replace(/\./g, '/');
  for (const dir of getLuciPackageUcodeDirs(ws)) {
    const cand = path.join(dir, `${rest}.uc`);
    if (isFile(cand)) return cand;
  }
  return null;
}

/**
 * Resolve a template-root include: `include('name')` → `<root>/name.ut` for the first
 * template root that has it (the name may contain slashes — `themes/bootstrap/header`).
 * Only meaningful when the INCLUDER is a LuCI env file; returns null otherwise, so
 * callers can fall through to the builtin file-relative model.
 */
export function resolveLuciTemplatePath(includerPath: string, name: string): string | null {
  if (name.startsWith('/') || name.endsWith('.uc') || name.endsWith('.ut')) return null; // a real path — builtin include semantics
  // Any file in a LuCI tree may render templates (dispatcher.uc itself does, via
  // runtime.render) — resolution needs only the tree, not the env-ambient gate.
  const ws = findLuciWorkspace(includerPath);
  if (!ws) return null;
  for (const root of getLuciTemplateRoots(ws)) {
    const cand = path.join(root, `${name}.ut`);
    if (isFile(cand)) return cand;
  }
  return null;
}
