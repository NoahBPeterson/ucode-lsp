# Guards on assignment-expression results: `(m = match(...)) != null` must narrow m in the branch

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Guard extraction now sees through an assign-and-test wrapper `(m = rhs)` (all four forms), the flow engine stores the assigned RHS type on both edges of the test, and a stale else-edge null-guard is invalidated by a reassignment in a sibling else-if's own condition.

## Fix

Two guard-extraction pieces + one flow-env piece, all in `src/analysis/typeChecker.ts`:

1. **Guard target sees through the assignment** (`guardedOperandName`): a comparison operand
   `(x = rhs)` (plain `=`, identifier target) yields the guarded identifier `x`, so
   `isNullGuardCondition`/`isNullCheckCondition` treat `(m = match(…)) != null` / `== null`
   exactly like `m != null` / `m == null`. `extractTypeGuard` gains the whole-condition
   truthiness form `if ((m = f()))` (assign-and-test, same falsy-capable semantics as bare
   `if (m)`); the `&&`/`while` forms already routed through `collectPositiveTestGuards`.
2. **The store happens on BOTH edges** (`makeEdgeGuardTransfer` + `collectConditionAssignments`):
   before applying edge guards, the engine sets `env[target] = typeof(RHS)` for every assignment
   embedded in the condition — so the guard narrows the FRESH match() result, not `m`'s stale
   loop-carried/declaration type. Positive edge → RHS with null removed (`array<string>`);
   negative edge → the flipped guard (`null`).
3. **Stale else-edge null-guard is reassignment-invalidated** (`collectGuards`, else branch):
   reaching a later `else if ((m = f()) != null)` means an earlier sibling's `(m = g()) != null`
   was false (m == null on that edge) — but m is REASSIGNED in the later condition, so the
   inherited "m is null" is stale. The else branch now runs `isVariableAssignedBetween` (mirroring
   the consequent's existing check) and drops the negated guard when the subject was reassigned
   before the read. Without this, activating (1) surfaced a spurious UC2004 on `split(m, …)`.

Result on run_tests.uc: both `m` UC5005 errors (lines 60, 66) gone; hover on `m` in those
branches shows `array<string>`. Tests: `tests/test-tc-flow-fp-trio.test.js` (all four forms +
the sibling-else-if reassignment case); the null-guard / elseif-nullprop / equality-hover suites
stay green. Repro: `zzzz/demo-tc-flow-fixes.uc`.

## The gap

The assign-and-test idiom — ubiquitous in parser-style loops — does not narrow:

```ucode
else if ((m = match(line, /^-- Expect (stdout|stderr|exitcode) --$/)) != null) {
    section = [ m[1], '' ];     // UC5005: "'m' is null here" (error) — FP
}
else if ((m = match(line, /^-- End( \(no-eol\))? --$/)) != null) {
    if (m[1] != null && ...)    // hover: m: array<string> | null — guard not applied
}
```

Inside the true branch, TWO facts hold and neither is being used:
1. `m` was just assigned the match() result (its flow type here is `array<string> | null`
   regardless of anything earlier — including the loop-carried state).
2. The `!= null` comparison on the ASSIGNMENT EXPRESSION's value narrows that same binding
   to `array<string>`.

Today the guard extraction (typeChecker.ts extractTypeGuard / guardsFromEdgeCondition) only
recognizes `Identifier != null` — an AssignmentExpression on the left of the comparison
produces no guard, so the branch state falls back to the (currently loop-broken, see
docs/tc-loop-carried-flow-join.md) ambient state: declaration-null → UC5005 hard errors.

## Proposed approach

1. In guard extraction, when the compared operand is an AssignmentExpression whose target is
   a plain Identifier, emit the guard against that identifier (and use the RHS's checked type
   as the base being narrowed). Handles `!= null`, `== null`, truthiness (`if ((m = f()))`),
   and the `while ((m = f()) != null)` loop form.
2. Independently of the comparison, an assignment inside a condition should update the
   branch-entry flow state for its target (both edges: the assignment happened regardless of
   the test outcome — the false edge gets `null`-ish narrowing per the flipped guard).

Note the interplay with tc-loop-carried-flow-join.md: fixing THIS ticket alone already kills
the `m` FPs (the assignment dominates the read), even before back-edge joins land — the two
tickets are independent and complementary.

## Classification

**Solvable.** Guard-extraction extension + condition-assignment flow update; no new lattice
machinery. Kills the 2 UC5005 hard errors on `m` in run_tests.uc; the idiom appears across
the corpus (grep `= match(` inside if/while conditions).
