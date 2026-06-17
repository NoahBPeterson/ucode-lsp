> ✅ **FIXED 0.6.252.** The optional epoch arg is coerced to int (`ucv_to_integer`), so a numeric string (`localtime("1700000000")`) is now accepted — the old false error is gone. A statically non-numeric value (a non-numeric string literal, array, object) silently coerces to `0` (= 1970), so it's a strict-gated **warning** (warn / error under `'use strict'`), never a hard error (ucode coerces it). Implemented via a new `softSeverity` mode on `validateNumericArgument`. Tests: `test-localtime-hexenc-coerce.test.js`.

# `localtime()` / `gmtime()` reject a string epoch — the argument is coerced to integer

**Severity: low (false positive at error severity).** `localtime()` and `gmtime()` raise a severity-1 error on a string argument, but ucode coerces the epoch argument with `ucv_to_integer`, accepting any numeric-convertible value.

## Reproduction

```ucode
let t = localtime("123");    // ERROR "Function 'localtime' expects integer or double for argument 1, but got string"
let u = gmtime("123");       // same
```

Verified: `ucode -R -e 'print(localtime("123") != null)'` → `true`, exit 0 (a valid broken-down-time object).

## Root cause

`src/analysis/checkers/builtinValidation.ts:1087` (localtime) / `:1093` (gmtime) require `integer | double`. The C source `lib.c:4982` (`uc_gettime_common`): `time_t t = ts ? (time_t)ucv_to_integer(ts) : time(NULL);` — `ucv_to_integer` coerces any value (including a numeric string).

## Fix

Accept any value for the optional epoch argument (it is coerced), or at most warn on a clearly non-numeric value.
