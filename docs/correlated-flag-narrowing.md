# Correlated-flag narrowing: `if (quote)` proves `start` non-null

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (may-null argument FP on real
upstream LuCI code — jow's `parse_args`, reported 2026-08-03; the user's
question: "start is only null when `!quote`, and here, `quote`. What kind of
dataflow analysis can we do here?").

## The report

```ucode
let esc, start, quote;
for (let off = 0; off <= length(str); off++) {
    ...
    else if (e && quote != 39) {
        esc = true;
        start ??= off;          // every path that keeps/created a truthy quote
    }                           // establishes start first...
    else if (q && quote && q == quote) {
        quote = null;
    }
    else if (q && !quote) {
        start ??= off;          // ...including the one that SETS quote
        quote = q;
    }
    else if (s && !quote) {
        if (start !== null) {
            unquote(start, off);
            start = null;       // start is cleared ONLY where quote is falsy
        }
    }
    else {
        start ??= off;
    }
}
if (quote)
    unquote(start, length(str));   // FP: "Argument is possibly 'null',
                                   //  expected 'integer'"
```

The invariant is relational: **at every program point, `quote` truthy ⇒
`start` non-null.** It holds by induction over the branches: the only write
that makes `quote` truthy (`quote = q`) is immediately preceded in the same
branch by `start ??= off`, and the only write that nulls `start`
(`start = null`) sits in a branch guarded by `!quote` (and `quote` is not made
truthy between that clear and the loop's next quote-write). Per-variable flow
analysis cannot see this — it tracks `start: integer | null` and `quote:
integer | null` independently, so `if (quote)` narrows only `quote`.

## What kind of dataflow analysis? The options ladder

1. **Full relational domains** (pairs/octagons over the flow engine): tracks
   joint facts like `quote != null ⇒ start != null` through joins. Precise and
   general — and exactly the kind of heavyweight machinery this project
   deliberately cut (see cfg-and-flow-engine memory: the CFG typing engine was
   removed for cost/complexity; don't resurrect it by another name).

2. **Guarded-pair invariant mining (recommended, scoped).** Syntactic,
   per-function, sound-by-construction check for the specific idiom:
   - Candidate pair (g, v) where a condition `if (g)` guards a use of `v`.
   - PROVE "g truthy ⇒ v non-null" by scanning every write in the function:
     (a) every write that can make `g` truthy is preceded, in the same
         straight-line branch, by a definite non-null write to `v`
         (`v ??= <non-null>` or `v = <non-null>`);
     (b) every write that can null `v` (`v = null`, bare `let v`) is dominated
         by a `!g` condition (or occurs before any g-truthy write);
     (c) neither g nor v is written through an alias/closure the scan can't
         see (bail on any escape — same conservatism as the 0.7.90
         unshared-fresh-reference walk).
   - When proven, `if (g)` (and `g &&` / early-return-on-`!g`) additionally
     removes NULL from v's narrowed type.
   The LuCI shape passes (a): `start ??= off; quote = q;` adjacent in-branch;
   and (b): `start = null` is inside `else if (s && !quote)`. Loops are fine
   because the proof is over ALL writes, positionlessly — the same trick that
   made the fresh-reference walk loop-safe.

3. **Assertion escape hatch** (orthogonal, cheap): honor an explicit
   `start != null &&` or a `die()`-guarded assert as narrowing — already
   works today; useless here because LuCI upstream won't be edited to please
   our linter.

Recommendation: (2), gated to exactly the null-flag idiom (guard variable
truthy-narrowing + null-removal on the partner). Start with `??=`-established
partners only — that alone covers parse_args — and extend if the corpus shows
more shapes. Note prior art: user-defined-guard-narrowing (docs/) explored
predicate FUNCTIONS as guards and was likely obsoleted by 0.7.85; this is a
different, variable-pair flavor and should reuse its lessons about blast
radius, not its implementation.

## Tests (when built)

parse_args itself (no may-null on `unquote(start, …)` under `if (quote)`);
mutation controls that BREAK the invariant and must keep the diagnostic:
a `quote = q` without the preceding `start ??=`, a `start = null` outside a
`!quote` guard, quote escaping into a closure that writes it; and the
independence control: `if (quote)` must NOT null-strip an unrelated variable.
