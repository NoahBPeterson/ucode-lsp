# UC4005 false positive: reassigning the iteratee to a fresh array inside the loop is wrongly reported as an infinite loop (Error)

**Severity: medium (false positive at error severity).** When a `for (x in a)` body reassigns `a` to a new array before pushing to it, the LSP reports `UC4005` ("grows 'a' every iteration ... infinite loop") at severity **Error**, but the loop terminates normally.

## Reproduction

```ucode
let a = [1, 2, 3];
for (x in a) {
    a = [];
    push(a, x);          // UC4005 (Error): "'push()' grows 'a' every iteration and the loop has no exit — infinite loop"
}
```

Verified: `/usr/local/bin/ucode` completes in 3 iterations. ucode's for-in iterates the array reference captured at loop entry; reassigning `a` inside the body makes `push(a, x)` grow a *different* array, so the original iteratee is untouched and the loop ends.

## Root cause

`semanticAnalyzer.ts` `checkIterateeMutation` (≈ line 3770) matches purely on the identifier name `a`, ignoring an intervening reassignment of that name within the loop body, then escalates to **Error** ("provably infinite"). This is the highest-severity false positive in the control-flow set — a red error on valid, terminating code.

## Fix

Bail out of (or downgrade) the UC4005 check when the iteratee name is reassigned earlier in the same loop body before the mutating call. At minimum, don't escalate to Error unless the iteratee is provably the same array object throughout.
