# `exists(obj, key)` falsely requires the 2nd argument to be a string — the key is coerced

**Severity: low (false positive).** `exists()` raises an error when its key argument isn't a string, but ucode coerces the key to a string.

## Reproduction

```ucode
let o = {"5": 1};
exists(o, 5);          // ERROR "Function 'exists' expects string for argument 2, but got integer"
```

Verified: `exists({"5":1}, 5)` → `true` (the `5` is coerced to `"5"`). C `uc_exists` (lib.c:804) does `uc_cast_string(vm, &key, ...)`.

## Root cause

`validateExistsFunction` (`builtinValidation.ts:666`) validates argument 2 strictly as `STRING`. (The first-argument over-strictness is the separate finding 33.)

## Fix

Accept any value for `exists`'s key argument (it is coerced to a string).
