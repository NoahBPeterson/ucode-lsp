# `==` / `!=` with a regex literal on the LEFT is always-false but not flagged (asymmetry)

**Severity: low (false negative + asymmetry).** UC2009 flags `1 == /re/` (regex on the right) but misses `/re/ == 1` (regex on the left), because the regex literal is mis-classified as the scalar operand.

## Reproduction

```ucode
let a = (/re/ == 1);     // always false — NOT flagged
let b = (/re/ != 0);      // always true  — NOT flagged
```

But `1 == /re/`, `"abc" == /re/`, and a regex *variable* `x == 1` ARE correctly flagged. Verified: `/re/ == 1` → `false`.

## Root cause

The parser sets a regex literal node's `value` to `String(pattern)` (`primaryExpressions.ts:105-107,137`). So `isScalarLiteral` (`typeChecker.ts:1228-1232`) sees `typeof value === 'string'` and mis-identifies the regex as the *scalar* operand; the integer `1` becomes the "other" operand, fails the `every(REF_EQ_BASES)` test, and `checkIncompatibleEquality` bails.

## Fix

Exclude `literalType === 'regexp'` from `isScalarLiteral` (one line), so the regex is treated as the reference operand on either side.
