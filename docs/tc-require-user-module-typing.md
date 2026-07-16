# `require("<user module>")` is never typed — only builtin modules resolve

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Built
in `semanticAnalyzer.ts` (declarator + bare-assignment require handling),
NOT `typeChecker.ts` — see "## Fix" for why the anchor moved.

## Fix

The ticket's root-cause pointed at `typeChecker.ts ~2672-2683`'s
`validateBuiltinCall` require special case. Investigation found that even the
PRE-EXISTING `require("./relative.uc")` handling — which already resolves the
path — never populated `propertyTypes` on the declared symbol anywhere
(`typeChecker.ts` has no lazy `importedFrom`-based member-access fallback for
non-builtin modules, unlike named/default ES6 imports). So member access on
ANY non-builtin `require()` result was `unknown` even when the path resolved
— not just the new bare-name case. Fixing it at the point where the symbol is
actually declared (`semanticAnalyzer.ts`'s `visitVariableDeclarator`, which
already special-cases `require()` for builtins/relative-paths/dot-notation)
keeps the change in one place and reuses the identical propertyTypes-stamping
pattern the ES6 default-import path uses (`processImportSpecifier`), rather
than adding a second, competing resolution machinery in `typeChecker.ts` that
risked clobbering the symbol's dataType via the generic
"upgrade-from-CallExpression-rich-type" path in `visitVariableDeclarator`
(~line 2852) — a real collision risk flagged by the house rule to keep
`typeChecker.ts` untouched here (peer agents were editing it concurrently).

Changes (`src/analysis/semanticAnalyzer.ts`):
- The existing require() special case in `visitVariableDeclarator` gained a
  new `else` branch: a literal argument that's neither a known builtin, a
  `./`/`../`/`/`-prefixed path, nor classic dot-notation (i.e. a bare
  single-segment search-path name like `"fw4"`) is now resolved via
  `fileResolver.resolveImportPath` — the SAME dotted/bare branch `import`
  uses (which, after `docs/tc-module-root-mapping.md`'s fix, also probes
  package deploy roots).
- New `requireResolvedUri` local threads the resolved URI to a new
  post-declare block (next to the existing `loadfileReturnShape`
  application): if the module's default export is a FUNCTION (factory), it's
  applied via the EXACT same `applyFactoryReturnInfo` +
  `getDefaultExportFunctionParameters` machinery the ES6
  default-import-of-a-factory path uses (`sym.dataType = FUNCTION`, so
  `fw4()`'s call result gets the factory's return shape — not `fw4` itself).
  Otherwise (object default export, OR ucode's "legacy" no-`export`-statements
  shape — a bare top-level `return {...}`, verified against lib.c
  `uc_require_library`: require() returns whatever the compiled program
  top-level `return`s, and `export` syntax is sugar for building that same
  value) `propertyTypes`/`propertyFunctionReturnTypes` are stamped directly.
- `hoistBareRequireModules` (the `name = require(...)` bare-assignment
  pre-pass, previously builtins-only) got the identical treatment, so a
  `try { m4 = require('mwan4'); } catch(e) {}`-style feature probe types too.
- New `fileResolver.ts` methods: `requireModuleIsFunction(uri)` (is the
  default export/legacy-return value itself callable?) and
  `getRequireModuleShape(uri)` (the object-shape case only — factory
  functions are handled directly via the pre-existing
  `getDefaultExportFunctionReturnInfo`/`Parameters`, not through this
  method). `getLoadfileProgramReturn`'s top-level-return-value walk was
  extracted into a shared private `topLevelReturnShape(body)` so both it and
  `getRequireModuleShape`'s legacy-module branch use one implementation.

Regression guard honored: an unresolvable module name inside `try {}` gets NO
new diagnostic (require() still has no UC3002-equivalent check) — verified
via test.

Known, deliberately-NOT-fixed gap: `require("mod")()` — an immediately-invoked
factory call in the SAME expression — isn't specially handled (mirrors how
`let x = require("mod"); x()` IS handled, but the double-call idiom isn't
verified anywhere in this workspace's corpus, unlike `loadfile(...)()` which
has its own dedicated, corpus-verified mechanism). Also unfixed: a THIRD hop
— calling a method on a factory's return value's own return type
(`inst.count()`'s return, where `inst = factory()`) — this is a pre-existing
inference-depth limit shared IDENTICALLY by the equivalent ES6
`import factory from '...'` path (verified side-by-side), not something this
fix introduced or could reasonably extend without touching that shared
machinery.

Before/after (`--type-coverage`):
- `firewall4/root/usr/share/firewall4/main.uc`: 48.1% (74/154) → 58.4%
  (90/154), +16. Smaller than the ticket's "~75 direct + ~100 downstream"
  estimate — `fw4.read_state()` itself now resolves (confirmed: the FIRST
  `fw4.read_state()` call site no longer appears in the unknown list), but
  many `fw4.*` methods' own bodies (e.g. `read_state`'s `json(...)`-based
  return) don't infer further, an unrelated depth limit. Diagnostics
  confirm `Cannot find module 'fw4'` is gone with no new errors introduced.

Tests: `tests/imports/test-require-user-module-typing.test.js` (10 cases:
firewall4-shape bare-name + legacy-return-module resolution/typing, a plain
relative require of a real object default export, a factory-function default
export (the factory itself types as function; its call result carries the
object shape; a method on that shape resolves), the bare `name =
require(...)` assignment form, and the unresolvable-module-stays-quiet
contract).

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
