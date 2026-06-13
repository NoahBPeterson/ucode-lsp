# `x in <string|number|null>` is flagged as a hard **error**, but ucode returns `false`

**Severity: medium (false positive at error severity).** The `in` operator with a scalar right-hand side raises a severity-1 error, but in ucode `in` over any non-array/non-object simply returns `false` — it never throws.

## Reproduction

```ucode
let r  = ("x" in "hello");     // ERROR "'in' operator requires object or array on right side, got string"
let n  = 5; let r2 = (2 in n); // ERROR "... got integer"
let r3 = (1 in null);          // ERROR
```

Verified: `ucode -R -e 'print("x" in "hello")'` → `false`, exit 0; `2 in 5` → `false`; `1 in null` → `false`. Confirmed in the C VM source `ucode/vm.c` `uc_vm_insn_in` — any non-array/non-object RHS hits `default: found = false`.

## Root cause

`typeChecker.ts` `checkInOperator` (≈ lines 1385-1392) raises an **Error** for a non-object/array RHS. This is distinct from finding 09 (which is about a `map()`/`filter()` result losing its array type) — here the RHS genuinely is a scalar, and ucode tolerates it.

## Fix

Don't error on a scalar `in` RHS. At most a warning ("`in` over a string/number is always false"); ideally nothing, since `x in maybe_object` is a common defensive idiom.
