# `n % 0` (modulo by literal zero) always yields NaN but is not flagged

**Severity: low (false negative, rare).** Modulo by a literal `0` always produces `NaN`, but the UC2008 NaN check doesn't cover it.

## Reproduction

```ucode
print(10 % 0);     // → NaN, but no diagnostic
```

Verified: `ucode -R -e 'print(10 % 0)'` → `NaN`. Note division by zero is **not** NaN (`1 / 0` → `Infinity`, `0 / 0` → `Infinity`), so only `%` by literal zero qualifies for this check.

## Root cause

`typeChecker.ts` `checkNaNArithmetic` (≈ line 1318) flags type-driven NaN (object/array operands) but not the value-driven `% 0` case.

## Fix

When the right operand of `%` is the literal `0`, emit a UC2008-style "always NaN" diagnostic. Do **not** extend this to `/ 0` (that yields `Infinity`, a valid value, not NaN). Minor/rare, listed for completeness of the NaN analysis.
