# Barrel re-exports (`export const X = _ns.member` / `= _ns`) drop all typing across files

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

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
