> ✅ **FIXED 0.6.253.** `isNumericConvertibleType` now splits a union and accepts it when **every** member is numeric-convertible (or `unknown`), so `sleep(unknown | double)` is clean (was a false error). A statically non-numeric `sleep` arg (non-numeric string, array) coerces to 0 ms — a strict-gated **warning** (warn / error under `'use strict'`) via the new `softSeverity` path, never a hard error. Tests: `test-arity-coercion.test.js`.

# Numeric builtins reject a union argument whose members are all numeric-convertible (`sleep`)

**Severity: low-medium (false positive).** A builtin like `sleep` checks "is this convertible to a number?" against the whole union *string* instead of per-member, so a `unknown | double` (all numeric-convertible) is wrongly rejected at Error severity.

## Reproduction

Real corpus: `utest/src/utest/runner/executor/parallel.uc:109` — `sleep(wait_ms)` where `wait_ms` is `unknown | double` from `clock()`-based arithmetic.

```ucode
function f() {
    let wait_ms = some_clock_calc();      // inferred unknown | double
    sleep(wait_ms);                        // "Argument 1 of sleep() cannot be a unknown | double..."
}
```

Verified: `sleep(10.5)` → exit 0. Both `unknown` and `double` are individually numeric-convertible.

## Root cause

`isNumericConvertibleType` (`builtinValidation.ts:106`) tests the whole union string `"unknown | double"` against an atom allow-list, instead of checking each member.

## Fix

Make `isNumericConvertibleType` split a union and accept it if **every** member is numeric-convertible (or contains `unknown`). Affects `sleep` (`:1252`) and any builtin using this predicate.
