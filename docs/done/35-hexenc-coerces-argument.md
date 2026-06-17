> ✅ **FIXED 0.6.252.** `hexenc` is total — it stringifies any value (`uc_hexenc` → `ucv_to_stringbuf`) — so a non-string is now a strict-gated coercion **warning** + the "Coerce to string" quick-fix (reuses #30's `coercesArgToString`), not a hard error. `b64enc` is left strict: it genuinely returns `null` for a non-string, so its definite-mismatch error stays (per #36). Tests: `test-localtime-hexenc-coerce.test.js`.

# `hexenc(non-string)` falsely rejected — `hexenc` stringifies any input (inconsistent with `b64enc`)

**Severity: low (false positive at error severity).** `hexenc()` raises a severity-1 error on a non-string argument, but `hexenc` stringifies any input. It is modeled identically to `b64enc`, but the two behave differently in the C source.

## Reproduction

```ucode
let x = hexenc(123);     // ERROR "Argument is possibly 'integer', expected 'string'"
```

Verified: `ucode -R -e 'print(hexenc(123))'` → `"313233"`, exit 0.

## Root cause

The `hexenc` entry has `nullMeansWrongType: true` (it is treated like `b64enc`). But the C sources differ:
* `lib.c:5239` (`uc_hexenc`) calls `ucv_to_stringbuf(...)` to stringify **any** input; it returns null only when the argument is *missing*.
* `lib.c:4790` (`uc_b64enc`) genuinely requires `UC_STRING` and returns null otherwise — so flagging `b64enc(123)` is defensible.

## Fix

Model `hexenc` as accepting any value (coerced to string), distinct from `b64enc`. Keep `b64enc` strict.
