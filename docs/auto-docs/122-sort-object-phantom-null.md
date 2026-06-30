# `sort(object)` is modeled as `object | null`, but an object argument never yields null

**Severity: low (phantom nullable).** Sorting an object returns the object; the LSP gratuitously unions in `null`, so callers see a phantom nullable.

## Reproduction

```ucode
let r = sort({a:1, b:2});      // hover r: object | null  (should be: object)
```

Verified: `type(sort({b:2,a:1}))` → `object`. C `uc_sort` (`lib.c:1540`) returns NULL only for a non-array/non-object arg or a comparator exception (which aborts the program anyway).

## Root cause

The array branch correctly drops null (`narrowedReturnType = ARRAY`), but the object branch (`builtinValidation.ts:1802`) unions in `NULL`.

## Fix

Type `sort(object)` as `object` (no `| null`), matching the array branch.
