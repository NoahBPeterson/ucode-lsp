# Strict `===`/`!==` between provably-different scalar types is always false but not flagged

**Severity: low (false negative).** A strict-equality comparison between two constants of different base scalar types is always `false` (strict equality does no coercion), but the LSP doesn't flag it — even though it flags the analogous reference-type cases (UC2009).

## Reproduction

```ucode
print(5 === "5");      // always false — not flagged
print(true === 1);      // always false — not flagged
print(5 === 5.0);       // always false (integer vs double, strict) — not flagged
```

Verified: all three → `false` in `/usr/local/bin/ucode` (strict equality does no coercion: `uc_vm_test_strict_equality(..., false)`).

Note the LSP correctly does **not** flag the *loose* `5 == "5"` (which IS `true` after coercion) — so the gap is specific to `===`/`!==`.

## Root cause

`typeChecker.ts` `checkIncompatibleEquality` (≈ line 1248) only fires when one side is a reference type, so scalar-vs-scalar `===` mismatches slip through.

## Fix

For `===`/`!==`, flag a comparison between two statically-known, distinct base scalar types (`integer`/`double`/`string`/`boolean`) as always-false/always-true, mirroring UC2009. Be careful to keep `integer === double` correct (strict `5 === 5.0` is false in ucode).
