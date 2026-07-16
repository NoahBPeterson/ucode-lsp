# Barrel re-exports (`export const X = _ns.member` / `= _ns`) drop all typing across files

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Alias
chasing added to `fileResolver.ts`'s named-export resolvers (not via the
`ModuleExport`/`findExports` provenance field the ticket sketched — a
simpler, equally general approach turned out sufficient; see "## Fix").

## Fix

Rather than adding alias provenance to `ModuleExport` (which would need
plumbing through `findExports`, `getModuleExports`, and every consumer), the
fix chases the alias INLINE, at the point each named-export resolver already
inspects the declarator's initializer — mirroring the existing
`resolveReexportedIdentifierType`/`findReexportedSource` machinery this
ticket's own root-cause section pointed at:

- **New helpers** (`fileResolver.ts`): `findNamespaceImportSource(fileUri, name)`
  — if `name` is bound by `import * as name from '<module>'` in `fileUri`,
  resolves that module's URI; `resolveNamespaceMemberAlias(fileUri, init)` —
  if `init` is `<ns>.<member>` where `<ns>` is a namespace import, returns the
  target module's URI + member name.
- **`resolveReexportedIdentifierType`**: now ALSO tries
  `findNamespaceImportSource` first (namespace re-export: `export const mock
  = _mock;` → `mock`'s property shape becomes the WHOLE namespace's exports,
  via `getNamespaceExportInfo`), falling back to the pre-existing
  named-import chase.
- **`getNamedExportTypeInfo`** (both the direct-declarator and `export { x }`
  specifier forms): added a `MemberExpression` branch alongside the existing
  `Identifier` branch — chases `<ns>.<member>` into the namespace's module and
  recurses into `getNamedExportTypeInfo` for that SAME member name (handles
  `export const describe = dsl.describe;`).
- **`getNamedExportFunctionReturnInfo`**: gained a `_visited` cycle-guard
  param (it didn't have one before — needed once this function recurses on
  aliases) and Identifier/MemberExpression alias chases in both the
  direct-declarator and specifier forms, so a re-exported FUNCTION's
  factory-return shape and simple return type both propagate.
- **`getNamedExportFunctionParameters`**: same Identifier/MemberExpression
  chases added to its direct-declarator form (the specifier form already had
  re-export chasing).
- **`getNamespaceExportInfo`'s `recordExport`**: chases Identifier
  (namespace-import) and MemberExpression (namespace-member) initializers the
  same way, so a NAMESPACE's own exports (not just a named-import's) carry
  through — this is what makes the two-hop `mock.global.patch` case work:
  `utest.mock.uc`'s `export const global = _global;` (itself a namespace
  re-export) now records `global` as `OBJECT` with `nested` = `_global`'s full
  export map, so `mock.global.patch` resolves via the existing one-level
  `nestedPropertyTypes` mechanism (base symbol `mock`, one level deeper
  `global`, whose nested shape has `patch`).

Cycle guard: shared `_visited` keys (`${fileUri}#${exportName}`) thread
through every recursive call, so `cycle_a.uc`/`cycle_b.uc` mutually
re-exporting the same name terminates instead of hanging (tested).

Non-import initializers (`export const x = 5;`) are untouched — the new
branches only fire when the initializer is an `Identifier`/`MemberExpression`
that resolves to an actual import binding; everything else falls through to
the pre-existing literal-inference path unchanged.

Before/after (`--type-coverage`):
- Ticket's exact 3-file repro (`leaf2.uc`/`mid2.uc`/`main2.uc`): 0/7 → 3/3
  identifiers typed (100%).
- `utest/examples/unit/09_mock_state_test.uc` (the `mock.global.patch`
  two-hop case): 11.4% (9/79) → 79.7% (63/79), +54.
- `utest/examples/unit/` aggregate (41 files, gated together with the deploy-root
  fix so `'utest'` resolves at all): 15.5% (348/2248) → 71.4% (1604/2248).

Tests: `tests/imports/test-barrel-reexport-typing.test.js` (6 cases: function-member
re-export incl. call-result typing, namespace re-export, the two-hop
`mock.global.patch` chain, a mutually-re-exporting cycle terminating, and a
non-import initializer staying literal-typed).

## The gap

A module that aggregates other modules and re-exports their members as `const`s — the barrel
pattern — exports names that type as `unknown` on the importer side, even when every underlying
definition is fully analyzable. Minimal verified repro (three files):

```ucode
// leaf2.uc
export function truthy() { return true; }
// mid2.uc  (the barrel)
import * as _c from './leaf2.uc';
export const truthy = _c.truthy;
// main2.uc
import { truthy } from './mid2.uc';
let t = truthy();          // truthy: unknown, t: unknown   (0/7 identifiers typed)
```

The whole utest surface is built this way (`utest/src/utest.uc:16-45`):

```ucode
export const describe = dsl.describe;      // function member re-export
export const mock = _mock;                 // NAMESPACE re-export (import * as _mock from 'utest.mock')
export const assert = _assert;
export const has_length = _combinators.has_length;   // → `has_length` cluster (6)
```

So even once `'utest'` resolves (see `docs/tc-module-search-roots-deploy-layout.md` tier 2),
`describe`/`it`/`assert`/
`mock`/`spy`/combinators all import as `unknown`, and `mock.global.patch` (a member path through TWO
namespace hops: `utest` barrel → `utest.mock` namespace → `_global` namespace re-export at
`utest/src/utest/mock.uc:232` `export const global = _global`) can't resolve. This gates the
~1,900-finding utest/examples population and the `mock.*` clusters (80+17 + snapshot/inject reads).

## Root cause

`src/analysis/fileResolver.ts:1136-1144` (`findExports`): an `ExportNamedDeclaration` wrapping a
`VariableDeclaration` records only

```ts
exports.push({ name: declarator.id.name, type: 'named', isFunction: false });
```

— the **initializer is never examined**. There is no record that the const aliases
`<namespace-import>.<member>` (or a whole namespace), so the importer-side symbol machinery has
nothing to chase: no signature, no return type, no object shape. The alias-chain following that
already exists for factory methods (0.6.103-104) and the loadfile-globals shape extraction
(`getLoadfileGlobals`) shows both halves of the needed machinery exist — they're just not wired into
`ModuleExport`.

## Proposed approach

Extend `ModuleExport` with alias provenance, populated in `findExports` by inspecting the
declarator init when it is:

- `Identifier` naming a namespace import → `{ namespaceOf: '<module>' }` (`export const mock = _mock`);
- `MemberExpression` `<nsImport>.<name>` → `{ aliasOf: { module: '<module>', name: '<name>' } }`
  (`export const describe = dsl.describe`);
- `Identifier` naming a local top-level function → reuse the existing `topLevelFunctionNames`
  treatment `export default` already gets (isFunction + signature).

On the importer side, when binding an imported symbol whose export carries provenance, resolve one
hop through the target module (recursively, with the resolver's existing cycle/depth guards): a
`namespaceOf` export types as a namespace of that module (member calls then resolve like any
`import * as x`), an `aliasOf` export types as the aliased function/const. The resolver AST cache
keeps this cheap; barrels are shallow (utest is depth 2).

Test cases: the 3-file repro above (function member, namespace, chained two-hop
`mock.global.patch`); aliased re-export names; a non-import initializer (`export const x = 5`)
keeps current literal typing; cycles don't hang.

## Classification

**Solvable** (mechanical cross-file plumbing; machinery precedents exist in-repo). Occurrences:
blocks the utest examples population (~1,900 findings incl. the `mock.global.patch` 97 and
`has_length` 6 clusters) behind tc-module-search-roots-deploy-layout.md; also any workspace using
barrel modules.
