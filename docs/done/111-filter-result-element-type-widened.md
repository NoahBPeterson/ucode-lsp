# `filter` result element type is widened (`array<integer | double>` instead of `array<integer>`)

**Severity: low (wrong inference).** `filter` cannot change element types, but a numeric-comparison predicate widens the result's element type.

## Reproduction

```ucode
let a = [1, 2, 3];
let b = filter(a, (e) => e > 1);     // hover b: array<integer | double>   (should be: array<integer>)
```

Verified: `filter([1,2,3], (e)=>e>1)` → `[2,3]` (all `int`). The element `e` itself correctly hovers as `integer`; only the propagated *result* element type over-widens.

## Root cause

`narrowFilterElementType` (`typeChecker.ts:1874`) applies the `e > 1` numeric guard via `applyTypeGuard`, whose `narrowToType` for a numeric comparison is the union `integer | double`, returned wholesale rather than **intersected** against the already-narrow `integer` base. Narrowing `integer` by `> 1` should remain `integer`.

## Fix

In the filter-narrowing path, intersect the guard's narrowed type with the input element type rather than replacing it — so filtering an `array<integer>` yields `array<integer>`.
