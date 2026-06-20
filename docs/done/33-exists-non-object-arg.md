# `exists(non-object, key)` falsely rejected — it returns `false`, never errors

**Severity: low (false positive at error severity).** `exists()` raises a severity-1 error when its first argument is not an object, but ucode returns `false` for a non-object first argument without throwing.

## Reproduction

```ucode
let x = exists(5, "x");      // ERROR "Function 'exists' expects object for argument 1, but got integer"
```

Verified: `ucode -R -e 'print(exists(5, "x"))'` → `false`, exit 0.

## Root cause

The C source `lib.c:794` (`uc_exists`): `if (ucv_type(obj) != UC_OBJECT) return ucv_boolean_new(false);` — graceful, no exception. `exists()` is total over all inputs, like `length()`. Emitting an error overstates it (the more common harmless case is `exists(maybe_null_obj, k)`).

## Fix

Don't error on a non-object first argument to `exists()` (it is total and returns `false`). At most a hint.
