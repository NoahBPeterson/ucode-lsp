# Forward `this.method()` calls inside an object literal keep the shallow pre-pass return type

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

When a method in an object literal calls a sibling method that is defined **later in the same
literal**, the call's return type comes from the 0.7.x pre-pass (`precomputeObjectMethodReturnTypes`),
which type-checks the sibling's `return` expressions **without the sibling's scope** — so any return
that mentions a local or parameter resolves `unknown`. The accurate type IS computed when the sibling's
body is finally visited, but it is never back-filled into the already-visited earlier callers, so every
forward call site is permanently stuck at the shallow type (typically `unknown | null`).

Real corpus — `firewall4/root/usr/share/ucode/fw4.uc`. `parse_invert` is defined at line 1302; seven
sibling methods defined *before* it call it (1087, 1110, 1133, 1144, 1191, 1205, 1237):

```ucode
parse_device: function(val) {          // fw4.uc:1086 — BEFORE parse_invert
    let rv = this.parse_invert(val);   // rv hovers `unknown | null`  ← shallow pre-pass type
    if (!rv)
        return null;
    ...
},
...
parse_invert: function(val) {          // fw4.uc:1302
    if (val == null)
        return null;
    let rv = { invert: false };
    rv.val = trim(replace(val, /^[ \t]*!/, () => (rv.invert = true, '')));
    return length(rv.val) ? rv : null; // real type: object | null — needs `rv` in scope
},
parse_limit: function(val) {           // fw4.uc:1313 — AFTER parse_invert
    let rv = this.parse_invert(val);   // rv correctly object | null (accurate type stamped by now)
    ...
},
```

The audit confirms the asymmetry directly: every `rv = this.parse_invert(val)` at 1087–1250 reports
`unknown | null` / `unknown`, while the identical call at 1314 (after `parse_invert` is visited) is
fully typed and does not appear in the report at all.

Minimal repro (verified with `node bin/ucode-lsp.js --type-coverage`):

```ucode
let o = {
    early: function(v) { let rv = this.late(v); return rv; },  // rv → `unknown | null`
    late:  function(v) {
        if (v == null) return null;
        let rv = { invert: false };
        return length(rv.val) ? rv : null;                     // object | null once visited
    },
    after: function(v) { let rv = this.late(v); return rv; },  // rv → object | null ✓
};
```

Occurrences: `this.parse_invert` alone is ~84 findings (38 reads + 32 `unknown | null` reads + 14
decls); with `this.parse_enum` and the smaller fw4/uspot/luci `this.*` forward calls the cluster is
**~100–120 occurrences**, plus the knock-on `unknown` that each stuck `rv` propagates through its
method's own return type.

## Root cause

`src/analysis/semanticAnalyzer.ts`:

- `visitObjectExpression` (~4280–4299) runs `precomputeObjectMethodReturnTypes` (~4354) before any
  body is visited. That pre-pass calls `collectReturnTypesQuiet` (~4370), which runs
  `typeChecker.checkNodeQuietly` on each `return` expression **outside the method's scope** — a return
  like `length(rv.val) ? rv : null` resolves `unknown | null` because `rv` isn't declared yet.
- `visitFunctionExpression` (~4448–4463) snapshots `this` for each method as it is visited:
  `inferObjectLiteralFunctionReturnTypes` (~4308) prefers the accurate `_inferredReturnType` stamped on
  already-visited siblings and **falls back to the pre-pass value for not-yet-visited ones** (line
  ~4320). So a forward reference is resolved from the shallow map — by design ("filled in later by the
  accurate per-method type"), except *"later" never reaches the earlier method*: its body was already
  checked, its `let rv = …` declarator symbol and the checker's node-type cache already hold the
  shallow type, and nothing revisits them.
- The object *variable's* own `propertyReturnTypes` (stamped post-visit at ~2986) is accurate — this is
  why external `fw4obj.parse_invert()` is fine and only **intra-literal forward** calls are affected.

## Proposed approach

Record-and-patch, not re-analysis:

1. While visiting a method body, whenever `inferMethodReturnType` Case 0 resolves a `this.X()` return
   type **from the pre-pass fallback** (i.e. the sibling's `_inferredReturnType` was not yet stamped),
   record a dependency: `{ objNode, methodName: X, consumers: [declaratorSymbol | cachedCallNode] }`.
2. After `super.visitObjectExpression(node)` completes (all siblings visited, accurate
   `_inferredReturnType` present on every function property), walk the recorded dependencies for that
   object: if the accurate type differs from the shallow one, patch the consumer — update the
   declarator symbol's `dataType`/`currentType` (and its flow-write, so `if (!rv)` narrowing reruns
   from the right base) and the typeChecker's cached type for the call node.
3. Bound the work: one patch pass per object literal, only over recorded forward-call consumers — no
   fixpoint, no second body visit. Chains (`early` calls `mid` calls `late`, both forward) resolve to
   one hop per pass; a second hop can be left shallow (rare; measure on fw4 before adding a bounded
   second iteration).
4. Alternative considered and rejected: visiting methods in dependency order — the `this`-call graph
   can be cyclic (`parse_invert` patterns aren't, but mutual recursion exists in the corpus) and
   reordering visits breaks the incremental cleanBodies cache keyed on body start offsets.

Hover/read sites need no change — they read the symbol table, which the patch updates. The main risk
is diagnostics already emitted from the shallow type inside the earlier method (e.g. a UC5006 null
warning that the accurate type would not produce); the patch pass should also re-run the small set of
type-dependent checks for the affected statements, or (simpler, phase 1) only patch when the shallow
type was `unknown`-based so no diagnostic could have keyed off it.

## Classification

**Solvable.** The accurate types already exist at object-literal-exit time; the fix is propagation
plumbing (record + patch), with an explicit bound of one pass per literal. No new inference is
invented, so no unsoundness: the patched type is exactly what a later caller already gets today.
Estimated impact: ~100–120 direct occurrences (fw4 `parse_invert`/`parse_enum` family dominate), plus
secondary wins wherever the stuck `unknown` propagated into the calling method's own return type.
