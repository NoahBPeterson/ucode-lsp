/*
 * include() scope extraction — phase 4b of the template-mode bring-up.
 *
 * ucode's `include(path, scope)` runs `path` as a template/script with the keys of the
 * `scope` object injected as its global variables. OpenWrt template trees use this to feed
 * render-context inputs to templates, e.g. (firewall4):
 *
 *     include("templates/ruleset.uc", { fw4, type, exists, length, include });   // main.uc
 *     include("rule.uc", { fw4, zone, rule });                                   // ruleset.uc
 *
 * So a template's "undefined" free variables (fw4/rule/zone/…) are actually injected by its
 * includer. This module extracts those include sites — the literal path and the scope keys —
 * which downstream passes use to (a) suppress UC1001 for injected names in the included file
 * and type them, and (b) flag a free var the scope does NOT provide, at the include site.
 *
 * Only statically-resolvable sites are reported: a STRING-LITERAL path and (for the scope)
 * an OBJECT-LITERAL argument. Spread/computed keys are noted via `hasDynamicScope` so callers
 * know the key set is incomplete and must not treat it as exhaustive.
 */

import { type AstNode } from '../ast/nodes';

/** How a scope value's type is determined. */
export type ScopeValueInfo =
  | { kind: 'type'; type: string }       // literal / object / array / function — concrete type
  | { kind: 'ident'; name: string }      // bare identifier — resolve to includer's type for it
  | { kind: 'require'; module: string }  // require("x") — module type if builtin
  | { kind: 'unknown' };

export interface IncludeSite {
  /** The literal path argument, verbatim (e.g. "rule.uc", "templates/ruleset.uc"). */
  path: string;
  /** Names the scope object provides to the included file (statically known keys). */
  scopeKeys: string[];
  /** Per-key info for inferring the injected name's TYPE (from the scope value expression). */
  scopeValues: Record<string, ScopeValueInfo>;
  /** True when a 2nd (scope) argument is present at all. A bare `include(path)` injects nothing. */
  hasScope: boolean;
  /** True when the scope object has a spread (`...x`) or computed (`[k]:`) member, so
   *  `scopeKeys` is NOT exhaustive — callers must not flag "missing key" against it. */
  hasDynamicScope: boolean;
  /** Source range of the whole `include(...)` call (for diagnostics at the host site). */
  start: number;
  end: number;
}

/** Read a property key name from either a `Literal` (shorthand `{ fw4 }` normalizes to a
 *  Literal "fw4") or an `Identifier` key. Returns null for anything else. */
function propertyKeyName(key: any): string | null {
  if (!key || typeof key !== 'object') return null;
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
  if (key.type === 'Literal' && key.value != null) return String(key.value);
  return null;
}

/** Classify a scope value expression into a type, an identifier reference, or a require(). */
function classifyScopeValue(node: any): ScopeValueInfo {
  if (!node || typeof node !== 'object') return { kind: 'unknown' };
  switch (node.type) {
    case 'Literal': {
      const v = node.value;
      if (v === null) return { kind: 'type', type: 'null' };
      if (typeof v === 'string') return { kind: 'type', type: 'string' };
      if (typeof v === 'boolean') return { kind: 'type', type: 'boolean' };
      if (typeof v === 'number') return { kind: 'type', type: Number.isInteger(v) ? 'integer' : 'double' };
      return { kind: 'unknown' };
    }
    case 'ObjectExpression': return { kind: 'type', type: 'object' };
    case 'ArrayExpression': return { kind: 'type', type: 'array' };
    case 'ArrowFunctionExpression':
    case 'FunctionExpression': return { kind: 'type', type: 'function' };
    case 'Identifier': return node.name ? { kind: 'ident', name: node.name } : { kind: 'unknown' };
    case 'CallExpression': {
      if (node.callee?.type === 'Identifier' && node.callee.name === 'require'
          && node.arguments?.[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
        return { kind: 'require', module: node.arguments[0].value };
      }
      return { kind: 'unknown' };
    }
    default: return { kind: 'unknown' };
  }
}

/**
 * Find every statically-resolvable `include(stringLiteral [, objectLiteral])` call in `ast`.
 * Matches the callee by name `include` (mirrors the existing builtin validator); a shadowing
 * local of the same name is a rare false match and harmless here (it only adds candidate
 * scope info that path resolution must still confirm).
 */
export function extractIncludeSites(ast: AstNode | null | undefined): IncludeSite[] {
  const sites: IncludeSite[] = [];

  const walk = (n: any): void => {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;

    if (n.type === 'CallExpression'
        && n.callee?.type === 'Identifier' && n.callee.name === 'include'
        && Array.isArray(n.arguments) && n.arguments.length >= 1) {
      const pathArg = n.arguments[0];
      if (pathArg?.type === 'Literal' && typeof pathArg.value === 'string') {
        const scopeArg = n.arguments[1];
        const scopeKeys: string[] = [];
        const scopeValues: Record<string, ScopeValueInfo> = {};
        let hasScope = false;
        let hasDynamicScope = false;

        if (scopeArg?.type === 'ObjectExpression') {
          hasScope = true;
          for (const p of scopeArg.properties ?? []) {
            if (p?.type === 'SpreadElement') { hasDynamicScope = true; continue; }
            if (p?.type === 'Property') {
              if (p.computed) { hasDynamicScope = true; continue; }
              const name = propertyKeyName(p.key);
              if (name !== null) {
                scopeKeys.push(name);
                scopeValues[name] = classifyScopeValue(p.value);
              } else {
                hasDynamicScope = true;
              }
            }
          }
        } else if (scopeArg) {
          // A non-literal 2nd argument (a variable, call, etc.) — scope exists but its
          // keys are unknown.
          hasScope = true;
          hasDynamicScope = true;
        }

        sites.push({
          path: pathArg.value,
          scopeKeys,
          scopeValues,
          hasScope,
          hasDynamicScope,
          start: n.start,
          end: n.end,
        });
      }
    }

    for (const k of Object.keys(n)) {
      if (k === 'leadingJsDoc') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const it of v) walk(it); }
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
    }
  };

  walk(ast);
  return sites;
}

/** Normalize a POSIX-ish path: collapse `.` and `..` segments. Keeps it dependency-free
 *  and identical under node and bun. Leading `/` is preserved. */
function normalizePath(p: string): string {
  const isAbs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(seg);
    }
  }
  return (isAbs ? '/' : '') + out.join('/');
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/**
 * Resolve an `include()` path the way ucode does: **relative to the including file's
 * directory** (verified vs the oracle — `include("sub/leaf.uc")` resolves against the
 * includer's dir, not cwd or a search path). An absolute path is normalized as-is.
 * Returns a normalized path suitable for keying the cross-file index.
 */
export function resolveIncludePath(rawPath: string, includerPath: string): string {
  if (rawPath.startsWith('/')) return normalizePath(rawPath);
  return normalizePath(`${dirOf(includerPath)}/${rawPath}`);
}

/** One resolved include site, from the includer's perspective. */
export interface ResolvedIncludeSite {
  includerPath: string;
  /** Statically-known scope keys provided to the target at this site. */
  keys: string[];
  /** Scope is non-exhaustive (spread/computed/non-literal) — don't flag "missing key". */
  hasDynamicScope: boolean;
  start: number;
  end: number;
}

/** What a target file receives, TRANSITIVELY, from its include chain. */
export interface IncludeScopeEntry {
  /** All names available in this file from include() injection — the site keys of every
   *  includer UNION each includer's own (transitive) injected scope. Verified vs the oracle:
   *  injected scope vars leak down into nested includes even when the inner site omits them. */
  injectedNames: Set<string>;
  /** True when `injectedNames` is exhaustive — i.e. NO site along any chain reaching this
   *  file has a dynamic (spread/computed/non-literal) scope. When false, the real set may be
   *  larger, so callers must NOT flag a name as "missing". */
  complete: boolean;
  /** Inferred type (a parseable type string) for injected names whose scope VALUE has a
   *  determinable, agreed type across all includers. Names with an unknown/conflicting value
   *  type are absent (the consumer treats them as `unknown`). */
  injectedTypes: Map<string, string>;
  /** The direct include sites that target this file (for host-site diagnostics). */
  sites: ResolvedIncludeSite[];
}

/**
 * Build the reverse index: resolved-target-path → its transitive injected scope.
 *
 * ucode's injected scope leaks down the include chain (oracle: a strict grandchild sees a
 * var its parent's include omitted), so `available(file)` is a fixpoint over the include
 * graph: `available(C) = ⋃ over each site (P → C, keys K) of (K ∪ available(P))`. Self- and
 * mutually-recursive includes (firewall4's zone-verdict includes itself) converge because the
 * union is monotone and finite. `complete` is false once any contributing chain is dynamic.
 *
 * `entries` are the workspace files (path + parsed AST; template files must be template-parsed
 * so their in-tag include() calls are present).
 */
export function buildIncludeScopeIndex(
  entries: Array<{ path: string; ast: AstNode | null }>,
  opts?: { resolveRequireType?: (module: string) => string | null },
): Map<string, IncludeScopeEntry> {
  const resolveRequireType = opts?.resolveRequireType ?? (() => null);

  // 1. Collect every scope-bearing site as (includer → target).
  const sites: Array<{ includer: string; target: string; keys: string[]; values: Record<string, ScopeValueInfo>; dynamic: boolean; start: number; end: number }> = [];
  for (const { path, ast } of entries) {
    for (const site of extractIncludeSites(ast)) {
      if (!site.hasScope) continue; // bare include(path) injects nothing
      sites.push({
        includer: path,
        target: resolveIncludePath(site.path, path),
        keys: site.scopeKeys,
        values: site.scopeValues,
        dynamic: site.hasDynamicScope,
        start: site.start,
        end: site.end,
      });
    }
  }

  // 2. Fixpoint over the include graph (names + completeness + injected TYPES, which depend
  //    on includer types for `ident` values, so they share the same iteration).
  const available = new Map<string, Set<string>>();
  const complete = new Map<string, boolean>();
  const typeOf = new Map<string, Map<string, string>>(); // file → name → agreed concrete type
  const conflict = new Set<string>();                     // "file\0name" with conflicting concretes
  for (const s of sites) {
    if (!available.has(s.target)) { available.set(s.target, new Set()); complete.set(s.target, true); typeOf.set(s.target, new Map()); }
  }
  const valueType = (includer: string, info: ScopeValueInfo | undefined): string => {
    if (!info) return 'unknown';
    if (info.kind === 'type') return info.type;
    if (info.kind === 'require') return resolveRequireType(info.module) ?? 'unknown';
    if (info.kind === 'ident') return typeOf.get(includer)?.get(info.name) ?? 'unknown';
    return 'unknown';
  };
  const contributeType = (target: string, name: string, t: string): boolean => {
    if (t === 'unknown') return false;
    const ck = `${target}\0${name}`;
    if (conflict.has(ck)) return false;
    const tmap = typeOf.get(target)!;
    const prev = tmap.get(name);
    if (prev === undefined) { tmap.set(name, t); return true; }
    if (prev !== t) { conflict.add(ck); tmap.delete(name); return true; }
    return false;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const s of sites) {
      // names
      const av = available.get(s.target)!;
      const before = av.size;
      for (const k of s.keys) av.add(k);
      const incAv = available.get(s.includer); // an includer with no entry is a root (received nothing)
      if (incAv) for (const k of incAv) av.add(k);
      if (av.size !== before) changed = true;
      // completeness — exhaustive iff the site is static AND the includer's own scope is.
      const incComplete = complete.has(s.includer) ? complete.get(s.includer)! : true;
      if ((s.dynamic || !incComplete) && complete.get(s.target) !== false) {
        complete.set(s.target, false);
        changed = true;
      }
      // types from this site's own keys (a site key shadows an inherited type)
      for (const k of s.keys) {
        if (contributeType(s.target, k, valueType(s.includer, s.values[k]))) changed = true;
      }
      // types inherited from the includer's own injected scope (leaked names keep their type)
      const incT = typeOf.get(s.includer);
      if (incT) for (const [name, t] of incT) {
        if (s.keys.includes(name)) continue; // site key already handled, takes precedence
        if (contributeType(s.target, name, t)) changed = true;
      }
    }
  }

  // 3. Assemble the index.
  const index = new Map<string, IncludeScopeEntry>();
  for (const s of sites) {
    let entry = index.get(s.target);
    if (!entry) {
      entry = {
        injectedNames: available.get(s.target) ?? new Set(),
        complete: complete.get(s.target) ?? true,
        injectedTypes: typeOf.get(s.target) ?? new Map(),
        sites: [],
      };
      index.set(s.target, entry);
    }
    entry.sites.push({ includerPath: s.includer, keys: s.keys, hasDynamicScope: s.dynamic, start: s.start, end: s.end });
  }
  return index;
}

// Node types that introduce a binding whose name must NOT count as a free variable.
const DECLARES_VIA_ID = new Set(['VariableDeclarator', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * Identifiers READ in `ast` but never declared anywhere in it (let/const/param/function/
 * import/for-loop var). Over-approximates the declared set (file-wide, not scope-precise),
 * which can only UNDER-report frees — safe for "missing scope key" enforcement (no false
 * positives). Used to check a template's needs against the scope its includer provides.
 */
export function computeFreeVariables(ast: AstNode | null | undefined): Set<string> {
  const declared = new Set<string>();
  const read = new Set<string>();

  const addId = (n: any) => { if (n?.type === 'Identifier' && n.name) declared.add(n.name); };

  const collectDecls = (n: any): void => {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator') addId(n.id);
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      addId(n.id);
      for (const p of n.params ?? []) {
        if (p?.type === 'Identifier') addId(p);
        else if (p?.type === 'RestElement' && p.argument?.type === 'Identifier') addId(p.argument);
        else addId(p?.id);
      }
    }
    if (n.type === 'ImportDeclaration') {
      for (const s of n.specifiers ?? []) addId(s?.local ?? s?.id);
    }
    if (n.type === 'ForInStatement' && n.left?.type === 'Identifier') addId(n.left);
    for (const k of Object.keys(n)) {
      if (k === 'leadingJsDoc') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const it of v) collectDecls(it); }
      else if (v && typeof v === 'object' && typeof v.type === 'string') collectDecls(v);
    }
  };

  const collectReads = (n: any): void => {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && n.name) {
      // Only count value-position reads: skip declaration ids, the `.prop` of a member,
      // and object-literal property keys (handled by their parents below).
      read.add(n.name);
    }
    for (const k of Object.keys(n)) {
      if (k === 'leadingJsDoc') continue;
      // Skip non-read identifier positions.
      if (n.type === 'MemberExpression' && k === 'property' && !n.computed) continue;
      if (n.type === 'Property' && k === 'key' && !n.computed) continue;
      if (DECLARES_VIA_ID.has(n.type) && k === 'id') continue;
      if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && k === 'params') continue;
      if (n.type === 'ForInStatement' && k === 'left') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const it of v) collectReads(it); }
      else if (v && typeof v === 'object' && typeof v.type === 'string') collectReads(v);
    }
  };

  collectDecls(ast);
  collectReads(ast);

  const free = new Set<string>();
  for (const name of read) if (!declared.has(name)) free.add(name);
  return free;
}

/** A host-site "scope does not provide" finding, ranged at the `include(...)` call. */
export interface IncludeScopeDiagnostic {
  start: number;
  end: number;
  message: string;
  missing: string[];
}

/**
 * Host-side enforcement: for each `include("tmpl", { … })` in `includerAst`, check that the
 * scope provides every free variable the target template needs. A free var that's neither in
 * the scope nor ambient (builtin / always-global) is genuinely undefined at render (verified
 * vs the oracle: strict → Reference error; non-strict → null) → flag it at the include site.
 *
 * Decoupled from I/O: `getTargetFreeVars(resolvedPath)` returns the target's free variables
 * (or null if it can't be resolved/parsed — then we can't enforce, so skip), and `isAmbient`
 * reports builtins / always-globals. Sites with a dynamic (spread/computed/non-literal) or
 * absent scope are skipped — the key set isn't exhaustive, so a "missing" claim wouldn't be
 * sound.
 */
export function checkIncludeScopes(
  includerAst: AstNode | null | undefined,
  includerPath: string,
  getTargetFreeVars: (resolvedPath: string) => Set<string> | null,
  isAmbient: (name: string) => boolean,
  /** The includer's OWN transitive injected scope (from the index). Those names leak into
   *  the child, so they count as provided. `complete: false` ⇒ the includer's scope is not
   *  fully known (a dynamic chain), so we cannot prove anything missing — skip enforcement. */
  includerScope?: { names: ReadonlySet<string>; complete: boolean },
): IncludeScopeDiagnostic[] {
  const out: IncludeScopeDiagnostic[] = [];
  // If the includer's own scope is incomplete, leaked names are unknown → don't flag.
  if (includerScope && !includerScope.complete) return out;
  for (const site of extractIncludeSites(includerAst)) {
    if (!site.hasScope || site.hasDynamicScope) continue;
    const target = resolveIncludePath(site.path, includerPath);
    const frees = getTargetFreeVars(target);
    if (!frees) continue;
    // Provided = keys passed here ∪ names that leak in from the includer's own scope.
    const provided = new Set(site.scopeKeys);
    if (includerScope) for (const n of includerScope.names) provided.add(n);
    const missing = [...frees].filter(n => !provided.has(n) && !isAmbient(n)).sort();
    if (missing.length > 0) {
      const names = missing.map(m => `'${m}'`).join(', ');
      out.push({
        start: site.start,
        end: site.end,
        missing,
        message: `Template "${site.path}" uses ${missing.length > 1 ? 'variables' : 'variable'} ${names}, but the include scope here does not provide ${missing.length > 1 ? 'them' : 'it'}.`,
      });
    }
  }
  return out;
}
