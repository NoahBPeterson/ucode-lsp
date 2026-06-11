# Member access on a provably-null value is unflagged (true-positive the LSP missed)

> **STATUS: FIXED (Tier 1) in 0.6.205; reassignment-to-null in 0.6.206.** The typeChecker's
> member-expression check now flags a non-optional member read / index / method-call when the
> receiver is **exactly null**. Optional chaining (`?.` / `?.[`) is exempt, and flow narrowing
> (truthy guards, reassignment in either direction) is honored. Tier 2 (`T | null` "possibly
> null") is intentionally out of scope. Tests: `tests/test-null-member-access.test.js` (20).
> Repro: `null-member-access-demo.uc`.

**Severity: medium (false negative).** Found while implementing 0.6.204 (uninitialized `let`
is now typed `null`). Reaching *through* a null value is a hard ucode runtime error, but the
LSP reported nothing.

## What ucode does (verified vs `/usr/local/bin/ucode`)

| Expression (receiver is null) | ucode result |
|---|---|
| `x.foo` (read) | `Reference error: left-hand side expression is null` |
| `x[0]` (index) | `Reference error: left-hand side expression is null` |
| `x.foo()` (method call) | `Reference error: left-hand side expression is null` |
| `x.foo = 1` (write) | `Type error: attempt to set property on null value` |
| `null.foo` (literal) | `Reference error: left-hand side expression is null` |
| `x?.foo` / `x?.[0]` (optional) | *no error* — short-circuits to null |
| `x = {…}; x.foo` (assigned first) | works |

So any **non-optional** member access / index / call on a value that is null at that point
is a guaranteed crash. Optional chaining is the sanctioned safe form.

## The two tiers

1. **Provably null** — the receiver's type is *exactly* `null` (uninitialized `let x;`,
   `let x = null;`, or a value narrowed to null by a guard). Non-optional access →
   guaranteed error. High confidence, low false-positive risk. **This is what 0.6.205
   implements.**
2. **Possibly null** — the receiver is a union `T | null` (a nullable builtin return,
   `fs.open()`, `sort()/keys()/filter()`, …). ucode errors only if it's actually null on
   that path. Useful but higher false-positive risk; needs full flow-narrowing of every
   guard form. **Deferred.**

## Implementation (Tier 1)

In `typeChecker.ts` `checkMemberExpression`, right after `narrowedBase` is computed: if the
receiver's base type is `NULL`, push an error (unless `node.optional`) and return `NULL`.
Covers both `.foo` and `[…]` (so it does **not** gate on `!node.computed`, unlike the
array/string checks). Flow narrowing is honored by consulting
`getNarrowedTypeAtPosition` for an identifier receiver — a truthy guard `if (x)` (which makes
the guarded body unreachable for a provably-null `x`) and a reassignment both clear the flag.

## Reassignment to null (fixed in 0.6.206)

Initially `let x = {a:1}; x = null; x.a;` was missed — but the root cause was a stale-shape
bug, not an inherent limitation: `let x = {a:1}` stamps `propertyTypes` (`a→integer`) on the
symbol, and `checkMemberExpression`'s property-type early-return returned that **without
checking the variable's current SSA type**, so it short-circuited before the null check.
Fixed by gating that early-return on `effectiveSymbolType(...) !== NULL` — once `x` is
reassigned to null, its dead object shape is ignored and the null check fires (most-recent
type wins). Guards still suppress it (`x = null; if (x) x.a` is clean).

## Property writes (0.6.207)

`x.foo = 1` / `x[0] = 1` on a null receiver was already flagged (the assignment LHS flows
through `checkMemberExpression`), but with the read-flavored message. ucode reports a
*different* error for writes ("Type error: attempt to set property on null value" vs the
read's "Reference error: …is null"), and optional chaining can't appear on an assignment
LHS. So when `isAssignmentTargetContext()` is true the message now says "Cannot set
property 'foo' on a null value … Assign a non-null value first, or guard against null" and
drops the `?.` suggestion. Reassignment-to-null and guards are honored for writes too.

## Tier 2 — possibly-null `T | null` (0.6.208)

Now flagged as a **warning** (not an error — it only crashes *if* null on that path).
Scoped to non-optional `.prop` access where every non-null union member is an object/handle
(so the access would otherwise be valid; scalar/array non-null members keep their own
"no members" errors — no double-flagging). Covers both direct chains (`cursor().foreach(...)`,
`fs.open(x).read()`) and stored handles (`let f = open(x); f.read()`), the latter via an
up-front check because handle method-resolution returns early. Flow narrowing silences it:
truthy guards, `if (x != null)`, early returns, and optional chaining all remove null.

Not noise — verified the producers are genuinely nullable: `uci.c` documents `cursor()` as
`@returns {?module:uci.cursor}` and `fs.open()` is likewise nullable, and a member access on
a null receiver is a hard runtime error (Tier 1). `foreach` handling null *entries* is
irrelevant — the *receiver* (the cursor) is what may be null, and that crashes before any
iteration.

**`'use strict'` escalation (0.6.209).** A possibly-null deref crashes identically in strict
and non-strict mode (verified — `'use strict'` governs *declarations*, not nulls), so this is
an LSP strictness *policy*, not semantics: under `'use strict'` the Tier-2 warning becomes an
**error** (mirroring TypeScript's `strictNullChecks`, and the same severity-escalation the
impossible-comparison / nullable-argument checks already use). Narrowing still applies, so
guarded code stays clean in both modes. Tier 1 (provably null) is an error regardless.

## Quick fixes (0.6.210)

Both diagnostics carry a code (`UC5005` provably-null, `UC5006` possibly-null) and fix-data,
and `server.ts` offers:
1. **Optional chaining** — `.`→`?.` (or `[`→`?.[`). Not offered on an assignment LHS (`?.`
   is invalid there).
2. **Null guard** — wrap the statement in `if (receiver) …`. Identifier receivers only (a
   direct call like `cursor()` would be evaluated twice, so guard is suppressed there —
   optional chaining is offered instead). Restricted to `ExpressionStatement` (wrapping a
   declaration would change scoping).

Tests: `tests/test-null-access-quickfix.test.js` (10) — edit text verified, write/direct-chain
exclusions, and applying a fix clears the diagnostic.

## Remaining scope notes

- Computed nullable index (`(array<T>|null)[i]`) isn't Tier-2-flagged yet (the computed-union
  path returns the element type early); deferred.
