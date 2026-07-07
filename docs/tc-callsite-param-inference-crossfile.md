# Call-site argument-union typing for exported functions and object-literal methods

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit (31,445 findings; the
`param-decl` + `read-of-param` bucket ≈ 16.8k occurrences, 53% of all findings). This ticket covers
the *cross-file* and *object-method* sub-populations that `tc-callsite-param-inference-local.md`
deliberately excludes.

## The gap

Many unannotated-param functions in the corpus are **not** file-local: they are exported and called
from importers, or they are methods on an object literal invoked via `obj.foo()` / `this.foo()`. Their
call sites are not all visible within the defining file, so the sound-local mechanism bails and the
params stay `unknown`.

```ucode
// pbr/files/lib/pbr/config.uc — exported factory, params are module handles
function create_config(uci_mod, ubus_mod, pkg) {   // all three: unknown  (line 7)
    let cursor_fn  = uci_mod.cursor;               // uci_mod: unknown → cursor_fn: unknown
    let connect_fn = ubus_mod.connect;             // ubus_mod: unknown
    ...
}
export default create_config;                       // line 188

// pbr/files/lib/pbr/pbr.uc — the ONLY call site, cross-file
import create_config from 'config';                 // line 17
let config = create_config(_uci, _ubus, pkg);       // line 37
//                          ^^^^  ^^^^^ these ARE typed (require("uci")/require("ubus")) at the call site
```

Here `uci_mod` is provably the `uci` module and `ubus_mod` the `ubus` module — the argument types
exist and are known — but they live in a *different file*, so nothing propagates them. Every
`uci_mod.cursor` / `ubus_mod.connect` read downstream is therefore also `unknown` (and their
`get_all`/`cursor()` results, and so on — a large cascade from three unresolved params).

Object-literal methods are the sibling case: a method `passthru: function(x){…}` invoked as
`o.passthru(5)` has its call args on the receiver expression, not resolvable without receiver-type +
member resolution.

## Root cause

- Same origin as the local ticket: params without `@param` are `UNKNOWN`
  (`src/analysis/semanticAnalyzer.ts:3759`).
- The cross-file resolver **already crosses the boundary for the reverse direction** — it reads a
  callee's *declared parameter list* to type-check an importer's call
  (`fileResolver.getNamedExportFunctionParameters` / `getDefaultExportFunctionParameters`, consumed at
  `semanticAnalyzer.ts:3364,3399`). What does **not** exist is the *forward* direction: scanning all
  importers to collect the *argument* types passed to an exported function and unioning them back onto
  the callee's params. The export/import index (0.6.168/0.6.174, cached export index +
  `invalidateDependents`) gives the importer set; the per-call argument collection and write-back pass
  is missing.
- Object-method call sites additionally need receiver-type resolution to bind `o.passthru(...)` to the
  method symbol; the `propertyReturnTypes` / `inferObjectLiteralFunctionReturnTypes` machinery (0.7.1)
  is the closest existing hook.

## Proposed approach

Build on the local mechanism (`tc-callsite-param-inference-local.md`), extended across files:

1. **Exported named/default functions.** For a candidate export with no `@param` JSDoc and no
   rest param, use the export index to enumerate importers, then for each importer's call site collect
   argument N's type via the cross-file type evaluation the resolver already performs. Union across
   **all** importers **and** any in-file self-calls.
2. **Escape gate, cross-file edition.** Bail if the export is ever referenced as a *value* in any
   importer (re-exported, stored, passed, aliased) — not just called — because that reintroduces
   invisible call sites. This is strictly harder than the local gate (must scan every importer's
   references, not just call positions), and must treat "an importer we haven't indexed yet" as a
   reason to stay `unknown` (soundness under partial indexing).
3. **Same any-unknown-collapses rule** as the local ticket: if any importer passes an unknown arg at
   position N, the param stays `unknown`.
4. **Object-literal methods (separate, lower priority).** Resolve `obj.method(...)` / `this.method(...)`
   receivers to the method symbol, then union its call args. Feasible only when the receiver's object
   type is known and the object doesn't escape (assigned elsewhere, returned untyped, etc.). Recursion
   through `this` and dynamic dispatch make the escape gate materially harder; treat as a stretch goal.

## Soundness risks

- **Partial / stale index.** Cross-file inference is only sound if the *complete* importer set is
  known. Workspace scanning is TTL-cached and incremental (`invalidateDependents`); a param typed from
  a partial importer set could be wrong. The pass must either wait for a complete scan or fall back to
  `unknown` when the importer set may be incomplete — never emit a narrowed type it can't stand behind.
- **Value-escape across files** is the dominant hazard and is invisible without scanning every
  importer's *reference* graph, not just its calls. A single `import foo; some_registry.push(foo)` in
  one importer invalidates the whole inference.
- **Re-export chains** (`export { create_config }` re-exported downward) must be followed;
  `findReexportedSource` (fileResolver.ts:1296) exists for the parameter-list direction but there is
  no argument-collection analogue.
- **Cost / invalidation churn.** Editing any importer changes an exported param's type, which changes
  the callee file's diagnostics — a fan-in re-analysis that the current `invalidateDependents`
  (dependents = importers) does not model in this direction (here the *callee* depends on its
  importers). Getting the invalidation graph wrong yields stale types, not crashes, but still FPs.
- **`this`-typing for object methods** has no sound story today; dynamic receivers can be anything.

## Classification

**Partially solvable.** Covers sub-population **(c) exported / cross-file** functions where the full
importer set is indexed, the export never escapes as a value, and callers pass concrete args (the
`create_config` shape is exactly this — a clean win once the forward-argument scan exists). Sub-
population **(d) object-literal methods** is only *partially* reachable and much harder (receiver +
escape + `this`), so it is a stretch goal within this ticket rather than a commitment. The
invalidation-graph and partial-index requirements make this meaningfully larger than the local ticket;
recommend landing `tc-callsite-param-inference-local.md` first and reusing its escape/collection
core here. Estimated reach: order-of 15–20% of the bucket (the exported-factory + exported-helper
slice), gated hard on complete indexing.
