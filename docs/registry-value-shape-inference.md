# Registry / dictionary value-shape inference — findings & design

Status: **investigated, not implemented** (deferred — moving to lower-hanging fruit).
Date: 2026-06-02. Branch context: `refactor/branded-checknode-return` (post Phase C).

## The problem

Real-world pattern from pbr.uc — a "registry" object held at factory/closure scope,
written through a setter and read through a getter:

```javascript
function create_pbr(...) {
  let iface_registry = {};                                   // closure-scoped map
  function set_interface(iface, data) {                      // setter
    let k = replace(iface, '-', '_');
    iface_registry[k] = data;
  }
  function get_interface(iface) {                            // getter
    let k = replace(iface, '-', '_');
    return iface_registry[k];                                // returns the map value
  }
  function get_mark(iface) { return iface_registry[replace(iface,'-','_')]?.mark; }
  // ...elsewhere, set_interface('wan', { mark, chain_name, strategy_name, ... });
  // ...and reads that currently FAIL to resolve:
  let chain_name = get_interface(iface).chain_name;          // → unknown
  let strategy_data = get_interface(iface);
  let sname = strategy_data?.strategy_name;                  // → no hover/type
}
```

Every `.chain_name` / `.strategy_name` / `.mark` pulled back out resolves to `unknown`.

## What actually works today (corrected finding)

The expensive interprocedural part **already works**. The 0.6.107 map-value-shape
inference (`inferMapValueShape`, `semanticAnalyzer.ts` ~2923–3037), including its
**Stage 2 setter hop** (`m[k] = param` → trace `param` to object-literal args at the
setter's call sites), correctly infers the factory-scoped registry's value shape:

```
iface_registry.valuePropertyTypes = [ "mark", "chain_name", "strategy_name" ]   ✅
```

> ⚠️ Measurement gotcha that misled the first pass: `symbolTable.lookup('iface_registry')`
> returns `undefined` for a **function-local** symbol after its scope has exited. Use
> `lookupAtPosition(name, posInsideFn)` to inspect locals post-analysis. The first repro
> reported `NONE` purely because of `lookup` vs `lookupAtPosition` — the feature is **not**
> broken and did **not** regress.

So the registry shape is known. The chain breaks **downstream**, at two small mechanical links.

## The two real gaps

### Gap 1 — getter return doesn't carry the value shape
`visitReturnStatement` (`semanticAnalyzer.ts` ~2307–2335) only collects
`functionReturnPropertyTypes` when the returned argument is an **ObjectExpression literal**
(`return { ... }`). A getter that does `return iface_registry[k]` (a `MemberExpression`)
returns `object` but contributes **no** property shape, so the function symbol gets no
`returnPropertyTypes`.

Result:
```
get_interface.returnPropertyTypes = NONE
let v = get_interface(iface):  v.dataType = object,  v.propertyTypes = NONE
```

**Fix:** generalize the return-shape capture beyond `ObjectExpression` — when the return
argument resolves to an object with a known shape (a map value `m[k]` where `m` has
`valuePropertyTypes`, or a `let v = m[k]` binding whose symbol has `propertyTypes`),
record that shape as the function's `returnPropertyTypes`. For `get_mark` returning
`iface_registry[k]?.mark`, the return is the *scalar* `valuePropertyTypes.get('mark')`.

Once Gap 1 is fixed, `let v = get_interface(iface); v.chain_name` and
`strategy_data?.strategy_name` resolve **for free** — the binding path already copies a
callee's `returnPropertyTypes` onto the variable (`semanticAnalyzer.ts` ~3200–3216),
and optional member access already consults `propertyTypes`.

### Gap 2 — member access on a call result
`get_interface(iface).chain_name` — in `checkMemberExpression` (`typeChecker.ts` ~2303),
when `node.object` is a `CallExpression` the checker uses the call's return *base type*
(`object`) but never consults the **callee's `returnPropertyTypes`** for the property.

**Fix:** when a `MemberExpression`'s object is a `CallExpression` whose callee symbol has
`returnPropertyTypes`, resolve the accessed property from there (mirror the existing
`let v = call()` binding-copy logic, but for the direct-chain case).

Both gaps are contained propagation fixes — **not** a fragile interprocedural build.

## The harder tail: non-uniform shapes

If `set_interface` is called with **different** shapes in different places (e.g. a strategy
entry vs. a plain marked-iface entry), the value-shape merge is an **intersection** — only
properties present in *every* write survive (`semanticAnalyzer.ts` ~3024–3036). So `mark`
(always present) stays, but `strategy_name` (only on strategy entries) is **silently
dropped to unknown**. That silent degradation is the real UX failure: the user can't tell
*why* `strategy_name` won't resolve.

## Proposed design: a hybrid (auto where sound, assisted-explicit where not, never silent)

1. **Fix the two links** (Gap 1 + Gap 2). Uniform registries then Just Work with zero
   annotation: `get_interface(i).chain_name` → `string`, etc.

2. **Detect non-uniformity and surface it.** The merge already sees every per-call-site
   shape. When they disagree on a property, emit a quiet hint/diagnostic on the declaration
   instead of swallowing it — e.g. *"`iface_registry` entries have varying shapes;
   `strategy_name`, `tid`, … can't be inferred uniformly."*

3. **Quick Fix: synthesize a `@typedef` from the observed shapes.** A code action on the
   registry declaration (or the getter) that generates a typedef from the **union** of all
   observed shapes and annotates the getter's `@return`, inserted above the declaration —
   the inference scaffolds the annotation; the user reviews/edits:
   ```javascript
   /** @typedef {Object} IfaceEntry
    *  @property {number} mark
    *  @property {string} [chain_name]      // optional — not on every entry
    *  @property {string} [strategy_name] */
   /** @param {string} iface @returns {IfaceEntry} */
   function get_interface(iface) { ... }
   ```
   The explicit typedef (with optional/union members) overrides the lossy intersection.
   NOTE: JSDoc `@returns` is already **parsed** (`jsdocParser.ts` ~74–86) but **never
   consumed** to populate `returnPropertyTypes` — wiring that consumption is a prerequisite
   for both the Quick Fix and any hand-written annotation to take effect (and it composes
   with Gap 2: the annotated return must then resolve through call-result member access).

## Implementation pointers (file:line, approximate)

| Concern | Location |
|---|---|
| Map value-shape inference (works, incl. Stage 2 hop) | `semanticAnalyzer.ts` `inferMapValueShape` ~2923–3037 |
| Trigger (empty `{}` declarator) | `semanticAnalyzer.ts` `visitVariableDeclarator` ~676 |
| `let v = m[k]` shape copy | `semanticAnalyzer.ts` ~648–661 |
| `let v = call()` returnPropertyTypes copy | `semanticAnalyzer.ts` ~3200–3216 |
| **Gap 1** — return-shape capture (ObjectExpression-only) | `semanticAnalyzer.ts` `visitReturnStatement` ~2307–2335 + merge ~1363–1376 |
| **Gap 2** — member access on call result | `typeChecker.ts` `checkMemberExpression` ~2303 |
| Non-uniform intersection merge (drops props) | `semanticAnalyzer.ts` ~3024–3036 |
| JSDoc `@returns` parsed but unconsumed | `jsdocParser.ts` ~74–86 |
| `Symbol.valuePropertyTypes` / `returnPropertyTypes` | `symbolTable.ts` ~326 |

## Open decisions (for whoever picks this up)

- **Scope:** the two inference links alone (covers uniform registries automatically), or the
  full hybrid (links + non-uniformity diagnostic + typedef-generating Quick Fix)?
- **pbr reality:** is `iface_registry` actually non-uniform (strategy vs. marked entries) or
  uniform-with-optionals? Decides whether the auto-path or the Quick-Fix/typedef path
  carries most of the value.

## Verification recipe (when implemented)

- Bun-native probe: analyze the factory repro above; assert
  `lookupAtPosition('iface_registry', …).valuePropertyTypes` has the keys,
  `get_interface.returnPropertyTypes` is populated, and the checked type of the
  `get_interface(iface).chain_name` MemberExpression node (`typeChecker.getTypeOf`) is `string`.
- Both suites + the differential harness; real-file diagnostic counts on pbr/mwan4 unchanged
  (this only *adds* resolution, should not add diagnostics).
- Oracle (`/usr/local/bin/ucode` + `type()`) for any new fixture's runtime shape.
