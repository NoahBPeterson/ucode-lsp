# `require("<user module>")` is never typed — only builtin modules resolve

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

`require()` of a **workspace user module** returns `unknown`, even though the same module consumed
via `import` gets full cross-file typing. The corpus idiom is a search-path module name:

```ucode
// firewall4/root/usr/share/firewall4/main.uc:3-6
let fw4 = require("fw4");          // fw4: unknown  (fw4.uc IS in the workspace)
let state = fw4.read_state();      // unknown — and every one of ~70 fw4.* reads after it

// pbr/files/lib/pbr/pbr.uc:2153
try { m4 = require('mwan4'); } catch(e) {}   // m4: unknown; m4.pkg.NFT_FILES unknown
```

Audit occurrences: `decl-from-call:require` 16 + `read-of-call-result:require` 70 = **86** (the
firewall4 `main.uc` file alone contributes 80 findings), plus everything member-read off the results.

Dynamic-argument requires are a separate, genuinely unresolvable sub-population:
`require(action.module)` (luci dispatcher.uc:828), ``require(require_path + `.${plugin_id}`)``
(luci luciplugins.uc:34).

## Root cause

`src/analysis/typeChecker.ts:2672-2683` (in `validateBuiltinCall`): the `require` special case only
returns a module type when the literal names a **known builtin** module:

```ts
if (reqArg && reqArg.type === 'Literal' && … && isKnownModule((reqArg as LiteralNode).value…)) {
  return { type: UcodeType.OBJECT, moduleName: … };
}
```

The comment above it says it explicitly: *"file-path requires (./…) need cross-file resolution →
TODO."* Everything the `import` path already has — `fileResolver.resolveImportPath` (dotted/bare
search-path resolution, `src/analysis/fileResolver.ts:648-707`), `getModuleExports` /
`loadModuleExports` (:902/:1058), default-export object shapes — is never consulted for `require()`.

Semantics check (`docs/done/ucode-module-resolution.md`): `require("name")` resolves the SAME
dotted/bare namespace as `import … from "name"` (templates over `REQUIRE_SEARCH_PATH`), and the value
is the module's **default export** (a `return`ed / `export default` value). So a literal-arg
`require("fw4")` should type exactly like `import fw4 from 'fw4'`.

## Proposed approach

In the `require` special case, when the literal is NOT a known builtin: resolve it through
`fileResolver.resolveImportPath` (the dotted/bare branch — `require` never takes `./` paths, that's
already UC3008), and if it resolves, type the call as the target's **default export** using the same
machinery the default-import declarator path uses (object shape → `propertyTypes` /
`propertyFunctionReturnTypes` on the receiving symbol, so `fw4.read_state()` resolves its return).
Cache by resolved path (the resolver AST cache already exists). Bare `name = require("x")` hoisting
(`hoistBareRequireModules`, semanticAnalyzer.ts:355) should take the same branch.

Note the dependency: `require("fw4")` from `root/usr/share/firewall4/` only resolves once the
sibling-install-root gap is fixed — see `docs/tc-module-root-mapping.md` (delta on
`docs/tc-module-search-roots-deploy-layout.md`). Land both to clear the firewall4 cluster.

Known limitation to keep: non-literal arguments stay `unknown` (dynamic plugin loaders) — that part
is by design.

Regression guard: `require("fw4")` inside `try {}` must keep working as a feature probe (don't turn
resolution failure of a *workspace-absent* module into a new diagnostic here; UC3002/UC3008 behavior
is out of scope).

## Classification

**Partially solvable** — literal search-path names: fully (≈75 of the 86 occurrences + their member
cascades); dynamic arguments: not resolvable by design (~11). Estimated recoverable: **~75 direct +
~100 downstream member reads.**
