# Mixed-instance `this`: precise handling for `shift(this)` on object|array unions

Status: **OPEN — brainstorm requested 2026-08-16.** Demo: `zzzz/mixed-proto-this.uc`
(container-run: `type(this)` really is `array` on one call and `object` on the
next; `om.go()` returns null SILENTLY — shift never throws).

## The situation

One prototype table, instances of two runtime types:

```ucode
const mixed_proto = { go: function() { return shift(this); } };
let om = proto({ f: 1 }, mixed_proto);   // object instance
let am = proto([1, 2], mixed_proto);     // array instance
```

`this` inside `go()` is typed as the union of proven instance types
(`object | array`), so `shift(this)` today gets the generic partial-mismatch
warning ("may be object") at the DEFINITION — which is a half-truth: the call
`am.go()` is fully legal, `om.go()` is a silent null. The warning sits on the
one line that is right for one caller and wrong for the other.

## The severity tiers as built (0.8.11, probe: `shift(this)` in a method)

| evidence | `this` type | result |
|---|---|---|
| plain literal, never proto-attached | object | **error** |
| all instances arrays | array | clean |
| all instances objects | object | **error** |
| mixed instances | object \| array | warning |
| opaque instance (`proto(make(), t)`) | object \| array | warning — proto() targets can only be objects/arrays, so an unproven instance still bounds the union |
| exported table, zero same-file instances | object | **error — KNOWN HOLE**: an importer could attach array instances; softening would require distinguishing prototype tables from ordinary exported namespace modules, which same-file evidence cannot do (and blanket-softening exported literals was measured safe for members but wrong in principle). Zero corpus hits today. Pinned as a documented-hole test. |

Member access on the union `this` is clean (the prototype-aware member path
handles possibly-array receivers; no UC5007 fallout — probed and pinned).

## The ruling that shapes option A

The standing param principle (nonstrict-semantics, user, strongly held):
body usage NEVER silently becomes a caller contract; it may only feed the
Add-JSDoc SUGGESTION, and the written annotation then drives diagnostics.
The rule-compliant fusion of A+C: infer the `this` demand → offer an
`@this {array}` suggestion (UC7003-style) → once annotated, check attach
sites and call sites hard. Silent call-site checking (bare option A) would
need an explicit user ruling that `this` is exempt because the receiver is
structurally bound by proto() rather than a calling convention.

## Options

### A. Method `this`-contract inference + call-site checking  ⭐ recommended
Infer each prototype method's demand on `this` from its body:
- array-demand: `shift/push/pop/splice/sort/…(this)`, `this[i]` writes
- object-demand: `this.x = …` (on an ARRAY this is a silent no-op —
  ucv_key_set coerces the key to an index and returns NULL)
- neutral: `length(this)`, `type(this)`, passing `this` onward
- a `type(this)` guard clears the demand (flow narrowing already models this)

Then:
- DEFINITION: flag only when the demand conflicts with EVERY proven instance
  type (a definite bug, e.g. `shift(this)` in a table with only object
  instances).
- CALL SITE: check the receiver's proven type against the demand —
  `om.go()` → "go() uses `this` as an array (shift, line N); `om` is an
  object, so this call silently returns null." The diagnostic lands on the
  call that is actually wrong. No false positive remains.

**Tension to resolve first:** the standing ruling "NEVER infer param type
from body usage" (non-strict semantics). `this` is arguably different — the
receiver relationship is structural (proto attachment), not a calling
convention, and the failure mode is a SILENT null (the `st.ino` class the
user has ruled must be surfaced). Needs an explicit user decision.

### B. Provenance-aware union softening
Tag the instance-union `this` type; suppress partial-mismatch warnings on it
at the definition. Kills the noise for free — but trades FP for FN unless
paired with A's call-site check. Only acceptable as A's companion.

### C. `@this {array}` JSDoc annotation
Author declares the intended receiver type per method; we type the body with
it and flag ATTACH sites that violate it ("mixed_proto expects array
instances; `om` is an object"). Zero inference, fully explicit, plays well
with the existing JSDoc machinery — but opt-in only.

### D. Type-guard quick fix on the existing warning
Keep the warning, attach the existing guard quick-fix machinery:
`if (type(this) != "array") return null;` — after which flow narrowing
silences the body. Cheap, complementary to everything above.

### E. Per-instance-type body instantiation (monomorphization)
Analyze the method body once per distinct instance base type with `this`
bound to each; report only findings that hold in EVERY instantiation (def
site) or in the matching one (call site). Most precise; subsumes A; cost is
bounded (×2) but touches incremental analysis. The heavy option — hold in
reserve if A's approximation ever misses.

### F. "Split the table" lint
Treat mixed instancing itself as the smell. Rejected: the runtime supports it
cleanly and ucode's own docs attach read() tables to arrays.

## Recommendation

A + D: contract inference with call-site diagnostics (pending the
body-inference ruling above), guard quick fix as the remedy. B's def-site
suppression only lands together with A. E in reserve.
