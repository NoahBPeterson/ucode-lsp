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
import { enclosingBindings, functionOwnBindings } from '../ast/scopeRoles';

/** A node viewed as an open record, for dynamic traversal/property access. AST nodes carry
 *  many type-specific fields that the base `AstNode` interface does not enumerate; this alias
 *  documents that we are reading those dynamically (after a `type`-string guard). */
type AnyNode = AstNode & Record<string, unknown>;

/** Narrow an arbitrary value to a traversable AST-like node (an object with a string `type`). */
function isNode(n: unknown): n is AnyNode {
  return !!n && typeof n === 'object' && typeof (n as { type?: unknown }).type === 'string';
}

/** How a scope value's type is determined. */
export type ScopeValueInfo =
  | { kind: 'type'; type: string }       // literal / object / array / function — concrete type
  | { kind: 'ident'; name: string }      // bare identifier — resolve to includer's type for it
  | { kind: 'require'; module: string }  // require("x") — module type if builtin
  | { kind: 'unknown' };

export interface IncludeSite {
  /** The literal path argument, verbatim (e.g. "rule.uc", "templates/ruleset.uc") — or,
   *  when `isPattern` is set, a glob-ish pattern with `*` standing in for each template-
   *  literal interpolation (`themes/${theme}/header` → `themes/*&#47;header`). */
  path: string;
  /** How the target renders: the `include()` builtin/env function, or a `render(...)` /
   *  `<obj>.render(...)` call (LuCI's runtime.render — template-root semantics only). */
  via: 'include' | 'render';
  /** True when `path` came from a template literal (or an identifier bound to one) and
   *  contains `*` wildcards — it may match SEVERAL targets, and only pattern-aware
   *  resolvers should touch it. */
  isPattern: boolean;
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

/** Merge mined scope info into an accumulator: a key seen twice with DIFFERENT value info
 *  degrades to `unknown` (we can't claim a type two call paths disagree on). */
function mergeScopeInfo(
  keys: string[], values: Record<string, ScopeValueInfo>,
  addKeys: string[], addValues: Record<string, ScopeValueInfo>,
): void {
  for (const k of addKeys) {
    if (!keys.includes(k)) {
      keys.push(k);
      const v = addValues[k];
      if (v) values[k] = v;
    } else {
      const prev = values[k];
      const next = addValues[k];
      if (prev && next && JSON.stringify(prev) !== JSON.stringify(next)) values[k] = { kind: 'unknown' };
    }
  }
}

/** Collect the statically-known keys/values of an object-literal scope argument. */
function collectObjectScope(scopeArg: AnyNode): { keys: string[]; values: Record<string, ScopeValueInfo>; dynamic: boolean } {
  const keys: string[] = [];
  const values: Record<string, ScopeValueInfo> = {};
  let dynamic = false;
  const properties = Array.isArray(scopeArg.properties) ? scopeArg.properties : [];
  for (const p of properties) {
    if (!isNode(p)) continue;
    if (p.type === 'SpreadElement') { dynamic = true; continue; }
    if (p.type === 'Property') {
      if (p.computed) { dynamic = true; continue; }
      const name = propertyKeyName(p.key);
      if (name !== null) {
        keys.push(name);
        values[name] = classifyScopeValue(p.value);
      } else {
        dynamic = true;
      }
    }
  }
  return { keys, values, dynamic };
}

/**
 * Mine the object SHAPE a bare-identifier scope argument carries: `include('tmpl', result)`.
 * The identifier's keys come from (checked in order, all same-file static evidence):
 *   1. a `let result = { … }` declarator initializer + any `result.k = …` /
 *      `result["k"] = …` member assignments anywhere in the file;
 *   2. when `result` is a PARAMETER of the enclosing function F: every object literal
 *      passed in that position at a direct call `F({…})`, PLUS one level of callback
 *      indirection — when F itself is passed as an argument to `G(F, …)`, the object
 *      literals G's body passes to that parameter (`callback({ ok, stdout, … })`). This is
 *      exactly LuCI's controller shape (execute_command(return_html, …) → callback({…})).
 *
 * The result is NEVER exhaustive (callers must keep hasDynamicScope=true): it exists to
 * feed injected NAMES (+ best-effort types) into the target template, not to prove a key
 * absent.
 */
function mineIdentifierScope(
  ast: AstNode | null | undefined, name: string, enclosingFns: AnyNode[],
): { keys: string[]; values: Record<string, ScopeValueInfo> } | null {
  const keys: string[] = [];
  const values: Record<string, ScopeValueInfo> = {};
  let found = false;

  const eachNode = (root: unknown, fn: (n: AnyNode) => void): void => {
    const walk = (n: unknown): void => {
      if (!isNode(n)) return;
      fn(n);
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc' || k.startsWith('_')) continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isNode(v)) walk(v);
      }
    };
    walk(root);
  };

  // 1. Local binding evidence: declarator init object literal + member assignments.
  eachNode(ast, (n) => {
    if (n.type === 'VariableDeclarator' && isNode(n.id) && n.id.type === 'Identifier' && n.id.name === name
        && isNode(n.init) && n.init.type === 'ObjectExpression') {
      const o = collectObjectScope(n.init as AnyNode);
      mergeScopeInfo(keys, values, o.keys, o.values);
      found = true;
    }
    if (n.type === 'AssignmentExpression' && isNode(n.left) && n.left.type === 'MemberExpression') {
      const left = n.left as AnyNode;
      if (isNode(left.object) && left.object.type === 'Identifier' && left.object.name === name) {
        const key = left.computed
          ? (isNode(left.property) && left.property.type === 'Literal' && left.property.value != null ? String(left.property.value) : null)
          : (isNode(left.property) && left.property.type === 'Identifier' ? String(left.property.name) : null);
        if (key !== null) {
          mergeScopeInfo(keys, values, [key], { [key]: classifyScopeValue(n.right) });
          found = true;
        }
      }
    }
  });

  // 2. Parameter evidence: object literals flowing into the enclosing function's param slot.
  const paramOwner = enclosingFns.find((f) => Array.isArray(f.params)
    && (f.params as unknown[]).some((p) => isNode(p) && p.type === 'Identifier' && p.name === name));
  if (paramOwner) {
    const paramIndex = (paramOwner.params as unknown[]).findIndex((p) => isNode(p) && (p as AnyNode).name === name);
    const fnName = isNode(paramOwner.id) && typeof paramOwner.id.name === 'string' ? paramOwner.id.name : null;
    if (fnName !== null && paramIndex >= 0) {
      const takeCallArg = (call: AnyNode, index: number): void => {
        const a = Array.isArray(call.arguments) ? call.arguments[index] : undefined;
        if (isNode(a) && a.type === 'ObjectExpression') {
          const o = collectObjectScope(a as AnyNode);
          mergeScopeInfo(keys, values, o.keys, o.values);
          found = true;
        }
      };
      eachNode(ast, (n) => {
        if (n.type !== 'CallExpression') return;
        const callee = n.callee;
        // Direct call: F({…}).
        if (isNode(callee) && callee.type === 'Identifier' && callee.name === fnName) takeCallArg(n, paramIndex);
        // Indirect: F passed as an argument to G(…) — follow G's matching param name
        // through G's body to the object literals it passes when calling it back.
        const args = Array.isArray(n.arguments) ? n.arguments : [];
        const fnArgPos = args.findIndex((a) => isNode(a) && (a as AnyNode).type === 'Identifier' && (a as AnyNode).name === fnName);
        if (fnArgPos < 0 || !isNode(callee) || callee.type !== 'Identifier') return;
        const gName = callee.name;
        eachNode(ast, (g) => {
          if (g.type !== 'FunctionDeclaration' || !isNode(g.id) || g.id.name !== gName) return;
          const gParams = Array.isArray(g.params) ? g.params : [];
          const cbParam = gParams[fnArgPos];
          const cbName = isNode(cbParam) && cbParam.type === 'Identifier' ? cbParam.name : null;
          if (typeof cbName !== 'string') return;
          eachNode(g.body, (c) => {
            if (c.type === 'CallExpression' && isNode(c.callee) && c.callee.type === 'Identifier' && c.callee.name === cbName) {
              takeCallArg(c, paramIndex);
            }
          });
        });
      });
    }
  }

  return found ? { keys, values } : null;
}

/** Read a property key name from either a `Literal` (shorthand `{ fw4 }` normalizes to a
 *  Literal "fw4") or an `Identifier` key. Returns null for anything else. */
function propertyKeyName(key: unknown): string | null {
  if (!isNode(key)) return null;
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
  if (key.type === 'Literal' && key.value != null) return String(key.value);
  return null;
}

/** Classify a scope value expression into a type, an identifier reference, or a require(). */
function classifyScopeValue(node: unknown): ScopeValueInfo {
  if (!isNode(node)) return { kind: 'unknown' };
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
    case 'Identifier': return typeof node.name === 'string' && node.name ? { kind: 'ident', name: node.name } : { kind: 'unknown' };
    case 'CallExpression': {
      const callee = node.callee;
      const args = node.arguments;
      if (isNode(callee) && callee.type === 'Identifier' && callee.name === 'require'
          && Array.isArray(args) && isNode(args[0]) && args[0].type === 'Literal'
          && typeof args[0].value === 'string') {
        return { kind: 'require', module: args[0].value };
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
  const fnStack: AnyNode[] = [];

  // A path argument as (pattern, isPattern): a string literal verbatim; a template
  // literal with each interpolation replaced by `*` (`themes/${theme}/header` →
  // themes/*/header — the LuCI theme-dispatch shims); an identifier resolved one hop
  // through its declarator initializer (`let p = \`themes/${x}/sysauth\`; render(p, s)`).
  const pathOf = (arg: unknown, depth = 0): { path: string; isPattern: boolean } | null => {
    if (!isNode(arg)) return null;
    if (arg.type === 'Literal' && typeof arg.value === 'string') return { path: arg.value, isPattern: false };
    if (arg.type === 'TemplateLiteral') {
      const quasis = Array.isArray(arg.quasis) ? arg.quasis : [];
      const exprs = Array.isArray(arg.expressions) ? arg.expressions : [];
      let out = '';
      for (let i = 0; i < quasis.length; i++) {
        const q = quasis[i] as AnyNode;
        const cooked = (q?.value as { cooked?: unknown } | undefined)?.cooked;
        out += typeof cooked === 'string' ? cooked : '';
        if (i < exprs.length) out += '*';
      }
      return exprs.length > 0 ? { path: out, isPattern: true } : { path: out, isPattern: false };
    }
    if (arg.type === 'Identifier' && typeof arg.name === 'string' && depth === 0) {
      // Every declarator initializer of this name must agree (dispatcher.uc declares its
      // theme_sysauth template path identically in two sibling blocks) — a genuine
      // disagreement means we can't know which path renders, so give up.
      const found: Array<{ path: string; isPattern: boolean } | null> = [];
      const scan = (n: unknown): void => {
        if (!isNode(n)) return;
        if (n.type === 'VariableDeclarator' && isNode(n.id) && n.id.type === 'Identifier' && n.id.name === arg.name && n.init) {
          found.push(pathOf(n.init, 1));
        }
        for (const k of Object.keys(n)) {
          if (k === 'leadingJsDoc' || k.startsWith('_')) continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const it of v) scan(it); }
          else if (isNode(v)) scan(v);
        }
      };
      scan(ast);
      if (found.length === 0 || found.some((f) => f === null)) return null;
      const first = found[0]!;
      return found.every((f) => f!.path === first.path && f!.isPattern === first.isPattern) ? first : null;
    }
    return null;
  };

  const walk = (n: unknown): void => {
    if (!isNode(n)) return;

    const isFn = n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
    if (isFn) fnStack.push(n);

    const callee = n.callee;
    // `include(...)` (builtin or LuCI env), bare `render(...)`, or `<obj>.render(...)`
    // (LuCI runtime.render) — all feed a render scope to a template.
    const via: 'include' | 'render' | null =
      isNode(callee) && callee.type === 'Identifier' && callee.name === 'include' ? 'include'
        : isNode(callee) && callee.type === 'Identifier' && callee.name === 'render' ? 'render'
          : isNode(callee) && callee.type === 'MemberExpression' && !callee.computed
              && isNode(callee.property) && (callee.property as AnyNode).name === 'render' ? 'render'
            : null;
    if (n.type === 'CallExpression' && via !== null
        && Array.isArray(n.arguments) && n.arguments.length >= 1) {
      const resolved = pathOf(n.arguments[0]);
      if (resolved !== null && resolved.path !== '') {
        const scopeArg: unknown = n.arguments[1];
        let scopeKeys: string[] = [];
        let scopeValues: Record<string, ScopeValueInfo> = {};
        let hasScope = false;
        let hasDynamicScope = false;

        if (isNode(scopeArg) && scopeArg.type === 'ObjectExpression') {
          hasScope = true;
          const o = collectObjectScope(scopeArg as AnyNode);
          scopeKeys = o.keys;
          scopeValues = o.values;
          hasDynamicScope = o.dynamic;
        } else if (isNode(scopeArg) && scopeArg.type === 'Identifier' && typeof scopeArg.name === 'string') {
          // A bare-identifier scope (`include('tmpl', result)`) — mine the identifier's
          // object shape from same-file evidence (declarator init / member assigns /
          // call-site object literals incl. one callback hop). The mined key set is
          // never exhaustive, so the site stays dynamic — it feeds names/types into the
          // target without licensing "missing key" claims.
          hasScope = true;
          hasDynamicScope = true;
          const mined = mineIdentifierScope(ast, scopeArg.name, [...fnStack].reverse());
          if (mined) { scopeKeys = mined.keys; scopeValues = mined.values; }
        } else if (scopeArg) {
          // Any other non-literal 2nd argument (a call, member expr, etc.) — scope
          // exists but its keys are unknown.
          hasScope = true;
          hasDynamicScope = true;
        }

        sites.push({
          path: resolved.path,
          via,
          isPattern: resolved.isPattern,
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
      if (k === 'leadingJsDoc' || k.startsWith('_')) continue; // skip runtime-stamped annotations (_inferredParams, etc.)
      const v = n[k];
      if (Array.isArray(v)) { for (const it of v) walk(it); }
      else if (isNode(v)) walk(v);
    }

    if (isFn) fnStack.pop();
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
  opts?: {
    resolveRequireType?: (module: string) => string | null;
    /** Non-file-relative include resolution, tried FIRST — e.g. LuCI's template-root
     *  `include('name')` → `<checkout>/…/ucode/template/name.ut` (luciEnv.ts). Returns an
     *  absolute path (same keying as the entries' `path`) or null to fall through to the
     *  file-relative model. */
    resolveTargetPath?: (rawPath: string, includerPath: string) => string | null;
    /** Pattern resolution for template-literal paths (`themes/*&#47;header` from the LuCI
     *  theme-dispatch shims) — every matching target receives the site's scope. Without
     *  this, pattern sites are dropped (never guessed). */
    resolveTargetPattern?: (pattern: string, includerPath: string) => string[];
  },
): Map<string, IncludeScopeEntry> {
  const resolveRequireType = opts?.resolveRequireType ?? (() => null);
  // Targets a site's scope reaches. `include` with a literal path keeps the builtin
  // file-relative fallback; `render(...)` / `<obj>.render(...)` is the LuCI runtime's
  // template-root method, so it resolves ONLY via the template-root hook (a bare
  // `render()` builtin call renders by path but injects the same way — the hook decides
  // whether the name maps to a workspace template). Patterns need the pattern hook.
  const targetsOf = (site: IncludeSite, includer: string): string[] => {
    if (site.isPattern) return opts?.resolveTargetPattern?.(site.path, includer) ?? [];
    const templateHit = opts?.resolveTargetPath?.(site.path, includer);
    if (templateHit) return [templateHit];
    return site.via === 'include' ? [resolveIncludePath(site.path, includer)] : [];
  };

  // 1. Collect every site as (includer → target). A site WITHOUT a scope argument
  //    injects no keys of its own, but it is still an EDGE: the includer's own injected
  //    scope leaks down into the child (oracle-verified — a nested include sees vars its
  //    own site omitted). LuCI's theme-dispatch shims are exactly this shape:
  //    header.ut does a bare `include(`themes/${theme}/header`)`, and the css/node
  //    scope its OWN includers provided must reach the theme copy.
  const sites: Array<{ includer: string; target: string; keys: string[]; values: Record<string, ScopeValueInfo>; dynamic: boolean; start: number; end: number }> = [];
  for (const { path, ast } of entries) {
    for (const site of extractIncludeSites(ast)) {
      for (const target of targetsOf(site, path)) {
        sites.push({
          includer: path,
          target,
          keys: site.scopeKeys,
          values: site.scopeValues,
          dynamic: site.hasDynamicScope,
          start: site.start,
          end: site.end,
        });
      }
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

  const addId = (n: unknown) => { if (isNode(n) && n.type === 'Identifier' && typeof n.name === 'string') declared.add(n.name); };

  const collectDecls = (n: unknown): void => {
    if (!isNode(n)) return;
    // Bindings via the shared, compiler-enforced classifier (let/const, fn names, params + rest,
    // catch params, import locals). This is file-WIDE (over-approximates the declared set across
    // nested functions too — safe: it can only UNDER-report frees), so we DO descend into nested
    // functions and collect their own params/rest as well.
    for (const nm of enclosingBindings(n as AstNode)) declared.add(nm);
    for (const nm of functionOwnBindings(n as AstNode)) declared.add(nm);
    // A bare `for (x in …)` loop var is an implicit global (an assignment, not a declaration, so
    // it's not a SCOPE_ROLE binding) — but for free-variable purposes it's assigned, so count it.
    if (n.type === 'ForInStatement' && isNode(n.left) && n.left.type === 'Identifier') addId(n.left);
    for (const k of Object.keys(n)) {
      if (k === 'leadingJsDoc' || k.startsWith('_')) continue; // skip runtime-stamped annotations (_inferredParams, etc.)
      const v = n[k];
      if (Array.isArray(v)) { for (const it of v) collectDecls(it); }
      else if (isNode(v)) collectDecls(v);
    }
  };

  const collectReads = (n: unknown): void => {
    if (!isNode(n)) return;
    if (n.type === 'Identifier' && typeof n.name === 'string' && n.name) {
      // Only count value-position reads: skip declaration ids, the `.prop` of a member,
      // and object-literal property keys (handled by their parents below).
      read.add(n.name);
    }
    for (const k of Object.keys(n)) {
      if (k === 'leadingJsDoc' || k.startsWith('_')) continue; // skip runtime-stamped annotations (_inferredParams, etc.)
      // Skip non-read identifier positions.
      if (n.type === 'MemberExpression' && k === 'property' && !n.computed) continue;
      if (n.type === 'Property' && k === 'key' && !n.computed) continue;
      if (DECLARES_VIA_ID.has(n.type) && k === 'id') continue;
      if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && k === 'params') continue;
      if (n.type === 'ForInStatement' && k === 'left') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const it of v) collectReads(it); }
      else if (isNode(v)) collectReads(v);
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
  /** When set and it resolves a site's path, that site is a TEMPLATE-ROOT include (LuCI
   *  render_any) — enforcement is skipped for it: the target also receives the whole env
   *  chain plus every OTHER includer's scope at render time, so a per-site "missing key"
   *  claim would not be sound. */
  resolveTemplateTarget?: (rawPath: string, includerPath: string) => string | null,
): IncludeScopeDiagnostic[] {
  const out: IncludeScopeDiagnostic[] = [];
  // If the includer's own scope is incomplete, leaked names are unknown → don't flag.
  if (includerScope && !includerScope.complete) return out;
  for (const site of extractIncludeSites(includerAst)) {
    if (!site.hasScope || site.hasDynamicScope) continue;
    // render() targets and pattern paths are template-root/dynamic renders — the target
    // also receives the env chain and other render scopes, so nothing is provably missing.
    if (site.via === 'render' || site.isPattern) continue;
    if (resolveTemplateTarget?.(site.path, includerPath)) continue;
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
