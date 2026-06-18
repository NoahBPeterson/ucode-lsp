> ✅ **FIXED 0.6.253.** `splice`'s real minimum arity is **1** — `splice(arr)` clears the whole array (`lib.c uc_splice` handles the `addlen == 1` form). Min arity lowered to 1, so `splice(arr)` / `splice(arr, i)` / `splice(arr, i, n)` are clean. `splice()` (zero args) is a UC2012 useless-call **warning** (returns null, modifies nothing) and its result type now narrows to `null`. `splice(5)` (non-array first arg) stays a UC2004 error. Tests: `test-arity-coercion.test.js`, `test-reassignment-builtin-hover.test.js`.

# `splice(array)` (1-arg) is falsely flagged — wrong minimum arity

**Severity: low (false positive).** `splice()` is modeled with a minimum of 2 arguments, but ucode's `splice` accepts a single array argument (which clears the whole array).

## Reproduction

```ucode
let a = [1, 2, 3];
splice(a);          // ERROR "Function 'splice' expects at least 2 argument(s), got 1"
```

Verified: `/usr/local/bin/ucode -R -e 'let a=[1,2,3]; splice(a); print(a)'` → `[ ]`, exit 0.

## Root cause

`src/analysis/checkers/builtinValidation.ts:1711` — `checkArgumentCount(node, 'splice', 2)`. The C source `lib.c:1599` (`uc_splice`) explicitly handles `addlen == 1` (the one-arg form) by removing all elements. The real minimum arity is **1**.

## Fix

Set `splice`'s minimum argument count to 1.
