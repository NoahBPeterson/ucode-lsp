# `obj[k] ??= []; push(obj[k], v)` — bucket idiom flagged "unknown"

Status: **investigated, not implemented.** Date: 2026-06-08.
Relates to `docs/registry-value-shape-inference.md` (the sound general fix, deferred).

## Symptom

```js
function sort_completion(data) {
    let categories = {};                 // object
    for (let entry in data) {
        let cat = entry.category ?? " ";
        categories[cat] ??= [];          // sets categories[cat] to an array if unset
        push(categories[cat], entry);    // "Argument 1 of push() is unknown. narrow to array"
    }
    return categories;
}
```

The user is right that `categories[cat]` is provably an array on the `push` line — it was just
`??=`'d to `[]` and `categories` is a fresh `{}` only ever written with arrays. The diagnostic
is a false positive.

## Two independent gaps (both reproduced)

```js
let categories = {};
categories["x"] ??= [];
push(categories["x"], 1);   // ✗ still flagged — even with a STATIC key
let v = plain["y"];         // v : unknown   (access on a fresh {} is unknown, not null)
```

1. **A computed/string-keyed read of an object is `unknown`** — the LSP can't track per-key
   value types, so `categories[cat]` is `unknown` regardless of what was written.
2. **`x ??= []` does not narrow the subsequent `x`** — there's no flow narrowing on the
   assignment target (true even for a static key, so it's not just the dynamic-key problem).

## Why it's genuinely array (soundness)

`x ??= []` writes only when `x` is null; afterward `x = nonNull(priorType) ∪ array`. The
`push` is safe iff `x` can't pre-hold a non-array. For `categories` that holds because it's a
**fresh `{}` whose values are written only by `??= []` (arrays) and `push` (keeps array)** — no
non-array ever enters. So `priorNonNull = array`, and `array ∪ array = array`. The blocker is
*proving* "every value in `categories` is an array," which is value-shape inference.

## Fix design — two levels

### A. The sound general fix: registry / dictionary value-shape inference
This is exactly `docs/registry-value-shape-inference.md` (deferred). Track the union of value
types written to a locally-created `{}` (`obj[k] = …`, `obj[k] ??= …`, `push(obj[k], …)`); when
they're uniformly arrays, type `obj[anyKey]` as `array | null` (null = absent key). Then
`??= []` drops the null → `array`. Covers this idiom and the broader pbr.uc registry pattern.

### B. A lighter, targeted, shippable rule: `??=`/`||=`-adjacency flow narrowing
Model `LHS ??= E` (and `LHS ||= E`) as both an expression and a flow fact:
- **Result/after-state:** for subsequent reads of the *same* `LHS` (identical identifier /
  static member / computed member with an unchanged key variable, no intervening write to the
  object or key), narrow `LHS` to `nonNull(priorType) ∪ typeof(E)`.
- For the bucket idiom this needs `priorType` to be null/array, not `unknown`. To get there
  without full (A), gate on a **mini value-shape check**: `LHS`'s object is a `{}`/`[]` literal
  created in this scope and no *non-array* value is ever assigned to `obj[*]` → treat the
  pre-`??=` value as `array | null`. Then `obj[k] ??= []` → `array`, and `push` type-checks.
- Soundness gate: if the object is a parameter or could hold a non-array (some `obj[k] =
  <non-array>` exists, or it escapes to an unknown sink), **decline** — stay `unknown`. This
  keeps `push(obj[k], …)` honest for the genuinely-unsafe case.

(B) is essentially a constrained slice of (A); if (A) is built, (B) falls out. Either way, the
`??=`-as-flow-fact piece (non-null after assignment) is independently useful and worth adding.

### Payoff

`categories[cat] : array` on the `push` line → the group-by/bucket idiom
(`m[k] ??= []; push(m[k], v)` / `m[k] ??= 0; m[k] += …`) stops false-flagging. This is one of
the most common ucode object-building patterns.

## Bottom line for the user

Yes — `categories[cat]` is an array there, and the diagnostic is wrong. Making the LSP see it
needs value-shape inference over the locally-built object (the deferred
`registry-value-shape-inference.md` work), of which a `??=`-adjacency rule gated on a
fresh-`{}`-with-only-array-writes is the minimal sound slice.
