# Falsy branch of a truthiness guard narrows non-nullable scalars to `unknown` and poisons every post-if read

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

Inside a function, **any** read of a boolean/integer/string variable AFTER an `if (v) …` statement
hovers as `unknown` — the truthiness test *destroys* the type it was supposed to refine:

```ucode
function g() {
  let b = 1 > 0;        // boolean
  if (b) print(1);
  b;                    // unknown  ✗  (should still be boolean)
}
function a1() {
  let h = 1 > 0;
  if (h) return;
  h;                    // unknown  ✗  (negative-edge fall-through)
}
function a3() {
  let h = 1 > 0;
  if (h) { h; }         // ✓ boolean (positive branch fine)
  else   { h; }         // unknown  ✗
}
```

Verified through the real LSP hover path (`tests/lsp-test-helpers.js` getHover): `b`/`n: 5`/`s: "x"`
post-if → `unknown`; an object variable happens to survive. Also affects narrowed builtin results:
`let u = length("abc"); if (u) …; u;` → unknown.

Real corpus sample: `pbr/files/lib/pbr/pbr.uc:2131` declares
`let has_netifd = length(keys(env.netifd_mark)) > 0;` — the reads at :2144 (inside the if chain) work,
but the read at **:2149** (after the first `if (has_netifd) mode = …` completes) reports `unknown`.
This pattern (test a scalar, keep using it) is ubiquitous, so the corpus share is much larger than
any single cluster key — every guarded-scalar read downstream of its guard inside a function body is
affected.

## Root cause

Three pieces compose (all verified by driving the internals directly with bun):

1. **Negative-edge guard flip** — `guardsFromEdgeCondition` (`src/analysis/typeChecker.ts:4510-4530`):
   for the else/fall-through edge of `if (b)`, the truthiness guard
   `{narrowToType: NULL, isNegative: true}` is flipped to `{narrowToType: NULL, isNegative: false}` —
   i.e. "keep only null".
2. **Empty narrowing encoded as UNKNOWN (top, not bottom)** — `applyTypeGuard`
   (typeChecker.ts:4633-4642) → `keepOnlyTypes(boolean, [NULL])` → `src/analysis/typeNarrowing.ts:108-111`:
   ```ts
   return { narrowedType: UcodeType.UNKNOWN, // Completely narrowed away
   ```
   A narrowing that eliminates every member returns **UNKNOWN** — the TOP type — instead of a
   bottom/never. (`removeTypesFromUnion` :69 has the same encoding.)
3. **Join absorbs top** — `joinTypes` (`src/analysis/flowTypeEngine.ts:88-96`): `unknown` is
   deliberately the lattice TOP, so the if-merge block joins `boolean ⊔ unknown = unknown`.
   Engine block dump for the repro: `if.merge in [["b","unknown"]]`.

So a branch that is *impossible* for the declared type (a null-only view of a non-nullable boolean)
is treated as "could be anything" and then wins the merge. The same empty→UNKNOWN encoding also
poisons the legacy in-branch path (a3's else-branch read).

Semantics note: the negative edge of `if (b)` is NOT "b is null" anyway — ucode falsy values include
`false`, `0`, `""`, so the correct falsy narrowing keeps falsy-capable members.

## Proposed approach

Two complementary fixes; either alone stops the poisoning, both together are right:

1. **Fix the falsy-edge guard**: the negated truthiness guard should narrow to the *falsy-capable*
   subset of the base (`boolean→boolean`, `integer→integer`, `string→string`, `T|null→null|…`), never
   to only-null. Minimal version: when the base type does not include `null`, the flipped
   truthiness guard is a no-op (keep the base).
2. **Introduce a real bottom**: make "completely narrowed away" a distinct `NEVER`/bottom marker (or
   `null`-as-empty sentinel internal to the engine) that `joinTypes` **ignores** (`join(T, ⊥) = T`)
   and that marks the edge's env entry as unreachable rather than unknown. This also improves genuine
   contradictions (`if (type(x)=="string") { } else if (type(x)=="string") { }`).

Guard-rail tests: the a1/a3/post-if repros above; `T|null` truthiness must still narrow correctly on
both edges (don't regress 0.6.x null-guard behavior, tests/…/182-null-guard-narrowing); while-loop
conditions (same edge machinery); object receivers unchanged.

## Classification

**Solvable** (localized: typeNarrowing.ts empty-result encoding + guardsFromEdgeCondition flip +
joinTypes bottom handling). Occurrence estimate: sample-confirmed in-slice (pbr `has_netifd`, post-
`if (pattern)` reads); systematic across the corpus — plausibly one of the largest single
contributors to the ~31.5k findings since it fires on every post-guard scalar read inside functions.
