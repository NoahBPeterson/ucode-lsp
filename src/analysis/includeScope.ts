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

import { AstNode } from '../ast/nodes';

export interface IncludeSite {
  /** The literal path argument, verbatim (e.g. "rule.uc", "templates/ruleset.uc"). */
  path: string;
  /** Names the scope object provides to the included file (statically known keys). */
  scopeKeys: string[];
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
        let hasScope = false;
        let hasDynamicScope = false;

        if (scopeArg?.type === 'ObjectExpression') {
          hasScope = true;
          for (const p of scopeArg.properties ?? []) {
            if (p?.type === 'SpreadElement') { hasDynamicScope = true; continue; }
            if (p?.type === 'Property') {
              if (p.computed) { hasDynamicScope = true; continue; }
              const name = propertyKeyName(p.key);
              if (name !== null) scopeKeys.push(name);
              else hasDynamicScope = true;
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
