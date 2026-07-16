# Loop-carried flow state: reads in a loop body must join the back-edge, not just straight-line state

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Loop head is now seeded as the JOIN of entry + end-of-body state and iterated to a widened fixpoint; the UC5005/UC2009 definite-null consumers re-query that joined state post-analysis and downgrade a may-null read from a hard error to a UC5006 warning (or suppress it when provably non-null).
**The dominant FP family in that file: 10× UC5005 errors, 2× UC2009, plus knock-on UC2004/nullable-argument — on ucode's own working test runner.**

## Fix

The FlowTypeEngine (`src/analysis/flowTypeEngine.ts`) already ran a worklist fixpoint over the
CFG (loop back-edges included), but the loop-body region STARVED to `∅`: `joinEnvironments` uses
an intersection meet (keep a key only when ALL predecessors carry it), and the loop head's
back-edge predecessor starts with an empty out-env, which permanently zeroes the intersection —
the wrong "pessimistic" initialization for an intersection meet. Three coordinated engine changes:

1. **Optimistic initialization** (`compute()`): skip NOT-YET-VISITED predecessors in the join
   (a `visited` set). On the loop head's first visit the unvisited back-edge no longer constrains
   the join, so the pre-loop state seeds the body; once the body has run and the tail is visited,
   the head is re-queued and joins the real end-of-body state (the loop-carried join). At the
   final fixpoint every reachable block is visited → the true meet.
2. **Monotone key accumulation + widening** (`widenEnv`/`widenType`): a key never DROPS from a
   block's out-env once seen (prevents present/absent flapping that otherwise churns to the
   iteration cap), and a changed key collapses to the base-union of old ⊔ new — bounding the
   otherwise-unbounded rich-`array<…>` element unions so the fixpoint closes (92 iterations for
   the run_tests loop vs. hitting the 784 cap before).
3. **Definite-claim consumers re-query the joined state** (`semanticAnalyzer.ts`
   `filterDiagnosticsWithFlowSensitiveAnalysis`): UC5005 (`NULL_MEMBER_ACCESS`) and UC2009
   (`IMPOSSIBLE_COMPARISON`) carry the receiver identifier + offset in their diagnostic data
   (`typeChecker.ts` `nullAccessFixData`/`checkIncompatibleEquality`); the post-analysis filter
   asks the now-built engine (`getNarrowedTypeAtPosition`) for the receiver's joined type and:
   provably non-null → suppress; may-null (null + a concrete non-null member) → downgrade UC5005
   to a UC5006 may-null WARNING; provably/undeterminably null → keep the error. UC2009 is
   suppressed when the receiver can be a non-null indexable (its element could match the literal).

Result on run_tests.uc: all 10 section UC5005 errors + both UC2009 errors gone (downgraded to
UC5006 may-null warnings on the genuinely first-iteration-nullable reads); 14 errors → 1 (a UC2004
knock-on guarded by `type(section[-1])`). Tests: `tests/test-tc-flow-fp-trio.test.js`;
`tests/inference/test-flow-engine-*` + `tests/test-tc-falsy-narrowing.test.js` stay green.
Repro: `zzzz/demo-tc-flow-fixes.uc`.

## The gap

```ucode
let testcases, testcase, section, m;                     // all start null
for (let line = fp.read('line'); length(line); line = fp.read('line')) {
    if (line == '-- Args --\n')       section = [ 'args', [] ];
    else if (line == '-- Vars --\n')  section = [ 'env', {} ];
    else if (...)                     section = [ m[1], '' ];
    else if ((m = match(line, /^-- End( \(no-eol\))? --$/)) != null) {
        if (m[1] != null && type(section[-1]) == 'string')   // UC5005: "'section' is null here" (error!)
        if (section[0] == 'code') { ... }                    // UC2009: "always false" (error!)
        section = null;
    }
    else if (section) { ... }
}
```

Every `section` read inside the `-- End --` branch is flagged **definitely null** (UC5005
"Cannot index into a null value"; UC2009 "a value of type null can never be == \"code\"").
At runtime `section` holds the tuple assigned by a header branch on a PREVIOUS iteration.

## Root cause

Branch-sensitive flow correctly excludes the sibling else-if assignments from the current
iteration's path — but nothing joins the **loop back-edge**: the state at the end of the loop
body (where `section` may be any of the tuples, or null) never flows back into the loop-head
state used for the next iteration's reads. The only surviving in-flow is the declaration's
initial `null`, so must-analysis concludes "definitely null" and emits ERRORS.

The flowTypeEngine's per-function fixpoint (Phase B/C) either doesn't iterate loop back-edges
to a fixpoint, or the guard/UC5005/UC2009 paths query a straight-line SSA (`typeHistory`
position-aware lookup) that is source-order-based and branch-filtered, not loop-aware. Pin
which consumer is at fault before designing the fix: hover shows `section: array<string>` at
line 69 (reasonable) while UC5005/UC2009 claim null — two consumers disagree, so at least one
is not using the engine's fixpoint state.

## Proposed approach

1. In the flow engine, seed the loop-head state as the JOIN of (entry state, end-of-body
   state) and iterate to fixpoint (standard dataflow; one extra pass over loop bodies).
2. Make UC5005/UC2009's must-claims ("IS null", "always false") require that the joined
   state — not the straight-line state — proves it. May-claims can stay warnings.
3. Regression guard: `for (…) { if (a) x = 1; else if (b) use(x); }` where x genuinely CAN
   be null on iteration 1 — a **may**-null warning (UC5006-style) is still correct there;
   only the definite-null ERROR must go. (In run_tests.uc a malformed input hitting
   `-- End --` first would really crash — "may be null" is defensible, "is null" is not.)

## Classification

**Solvable.** Standard dataflow back-edge join. High-value: converts hard errors on
correct upstream code into (at most) soft may-warnings. Related memory/docs:
docs/ (flow engine Phase B+C), CFG is reachability-only — implement in flowTypeEngine, do
not resurrect CFG typing.
