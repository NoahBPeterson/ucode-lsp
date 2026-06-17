> ✅ **FIXED 0.6.251.** `match` is now handled asymmetrically, matching `uc_match` (lib.c): **arg 1 (subject)** is coerced to a string → a non-string is a strict-gated warning (warn / error under `'use strict'`) + the "coerce to string" quick-fix (reuses #30's `coercesToString`); **arg 2 (pattern)** stays a hard error (ucode never treats a string as a regex — it returns null) but now offers a **"convert to regex literal"** quick-fix built from the *source* text (escapes like `\d`/`\b` preserved, slashes escaped). Also hardened the quick-fix layer so a singular non-narrowable type never gets a bogus type-guard fix. Tests: `test-match-arg-validation.test.js`.

# `match(non-string, regex)` falsely rejected — the subject is coerced

**Severity: low-medium (false positive at error severity).** `match()` raises a severity-1 error when its first argument (the subject) is not a string, but ucode coerces the subject to a string; only the *pattern* (arg 2) must be a regex.

## Reproduction

```ucode
let m = match(123, /2/);     // ERROR "Function 'match' expects string for argument 1, but got integer"
```

Verified: `ucode -R -e 'print(match(123, /2/))'` → `[ "2" ]`, exit 0.

## Root cause

`src/analysis/checkers/builtinValidation.ts:508` enforces a string type on argument 1. The C source `lib.c:3126` (`uc_match`) does `p = uc_cast_string(vm, &subject, ...)` — the subject is stringified, so any value is valid there. (The pattern argument check is correct and should stay.)

## Fix

Drop the string-type requirement on `match()`'s first argument (accept any value; it is coerced). Keep the regex requirement on argument 2.
