# Analyzer crash: `SCOPE_ROLE[node.type]` on a `_inferredParams` annotation kills whole-file analysis

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

Any file that assigns an **object literal containing a function-valued property to an implicit
global or `global.X`** loses its ENTIRE semantic analysis — every variable in the file reports
no hover, and all semantic diagnostics vanish (replaced by one opaque
`error: Semantic analysis error: Cannot read properties of undefined (reading 'binds')`).

Minimal repro (verified against the current build):

```ucode
uvol_uci = { f: function(a) { return a; } };   // CRASH — whole file dead
```

`global.v = { f: function(a) { return a; } };` crashes identically. `let v = { f: … }` does not
(the guard pass early-returns when there are no global object bindings).

Real corpus casualties (all no-hover findings in these files are THIS crash):

- `packages/utils/uvol/files/uci.uc` — 26 occurrences (`uvol_uci = { uvol_uci_add: function(…) … }`)
- `packages/utils/uvol/files/blockdev_common.uc` — 10 occurrences (`blockdev_common = {}` +
  function-property member assigns)

That's 36 of the 1,987 no-hover occurrences, but the pattern (`global.X = { method: function… }`
"poor man's module") is pervasive in OpenWrt code — every such file is fully dead to the analyzer.

## Root cause (verified with a stack trace)

1. During the main traversal, `visitFunctionExpression` / arrow visitor stashes the param
   signature ON THE AST NODE: `(node as any)._inferredParams = this.buildFunctionExprParamInfos(node)`
   (`src/analysis/semanticAnalyzer.ts:4501` and `:4585`). A `ParamInfo` looks like
   `{ name: 'a', type: 'unknown', isRest: false }` — note the **string `type` field**.

2. At the end of `visitProgram`, `checkNeverAssignedGlobalProperties` (UC8007 family,
   `semanticAnalyzer.ts:617`) runs a taint walk over the AST. Its node test is
   `isAstNodeLike(n)` = "object with a string `.type`" (`semanticAnalyzer.ts:51`), and its
   recursion iterates **every key** of every matched node (`:721-726`), so it descends into the
   stamped `_inferredParams` array and treats `{ name:'a', type:'unknown', isRest:false }` as an
   AST node.

3. The walk calls `enclosingBindings(n)` (`:655`) which indexes the total record:
   `SCOPE_ROLE[node.type].binds` (`src/ast/scopeRoles.ts:97`). `SCOPE_ROLE['unknown']` is
   `undefined` → `TypeError: Cannot read properties of undefined (reading 'binds')`.

4. The exception unwinds through `visitProgram` to `analyze()`'s top-level catch
   (`semanticAnalyzer.ts:407`), which converts it to a single "Semantic analysis error"
   diagnostic and returns a symbol table containing **only the pre-declared builtins** — no
   user symbols at all. Hence: no hovers anywhere, no UC1001/UC2xxx/UC5xxx for the whole file.

Stack (captured via instrumentation):

```
TypeError: undefined is not an object (evaluating 'SCOPE_ROLE[node.type].binds')
    at enclosingBindings (src/ast/scopeRoles.ts:97)
    at walk (src/analysis/semanticAnalyzer.ts:655)
    …
    at checkNeverAssignedGlobalProperties (src/analysis/semanticAnalyzer.ts:728)
    at visitProgram (src/analysis/semanticAnalyzer.ts:593)
```

Regression window: the taint walk predates it, but 0.7.63 routed it through the compiler-enforced
`SCOPE_ROLE` record (memory: "Scope/binding classification is CENTRALIZED"). The record is total
over `AstNodeKind` — which is exactly why it (correctly) has no entry for a non-AST object that
merely *looks* node-like. The pre-0.7.63 ad-hoc `switch` fell through harmlessly.

`_inferredReturnType` (`:4497`, `:4582`) is the same class of hazard: a rich `UcodeDataType`
like `{ type: 'object', moduleName: … }` also passes `isAstNodeLike`.

## Proposed approach

Two independent hardenings (do both):

1. **Make `enclosingBindings`/`functionOwnBindings`/`opensFunctionScope` total-safe**: guard
   `SCOPE_ROLE[node.type]` with `?? NONE` (or an explicit `isRealNodeKind` check). The record's
   compile-time totality over `AstNodeKind` is untouched; this only protects against runtime
   values whose `.type` is not an `AstNodeKind` at all (annotations, rich data types). Same
   guard belongs in `includeScope.ts:363-364` (same helpers, same walk style).

2. **Stop leaking annotations into AST walks**: either skip known annotation keys
   (`_inferredParams`, `_inferredReturnType`, and any future `_`-prefixed stash) in the generic
   key-recursion loops (the `k === 'leadingJsDoc'` skip already exists — extend it to
   `k.startsWith('_')`), or move the stashes into a side `WeakMap<AstNode, …>` so the AST stays
   pure. The WeakMap is the structurally-correct fix; the key-skip is the cheap one.

Also worth a sweep: every other `isAstNodeLike`-based walk that iterates `Object.keys`
(`collectImplicitGlobalNames`, the loadfile/include walks, `computeFreeVariables`) has the same
latent exposure to stamped annotations, even where it doesn't crash today.

## Test cases

- `uvol_uci = { f: function(a) { return a; } };` → no crash; `uvol_uci` gets its implicit-global
  handling; `f`'s param hovers.
- `global.v = { f: (x) => x };` → no crash (arrow variant, `:4585`).
- Regression: UC8007 never-assigned-global-property detection still fires on its existing tests.
- The two uvol files produce their normal diagnostics (UC3006 fs-import errors etc. — already
  emitted before the crash — PLUS the full type-checking output that's currently missing).

## Classification

**Solvable** — a contained bug fix. 36 corpus occurrences directly (uvol uci.uc 26 +
blockdev_common.uc 10), plus every future file using the extremely common
`global.X = { method: function… }` module idiom.
