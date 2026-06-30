# Bitwise operation on a `double` operand warns, but it's a valid, common idiom

**Severity: low (noise).** A bitwise operator with a `double` (or `string`) operand emits a warning, but ucode coerces the operand to an integer cleanly — `x | 0` is the standard truncate-to-int idiom.

## Reproduction

```ucode
let a = 1.5;
let b = a | 0;     // WARNING "Bitwise operation on unexpected types: double | integer. Consider using boolean or integer types..."
```

Verified: `ucode -R -e 'print(1.5 | 0)'` → `1`. String operands likewise: `"5" & 3` → `1`.

## Root cause

`typeChecker.ts` `checkBinaryExpression` (≈ lines 813-823) treats only `BOOLEAN`/`INTEGER`/`UNKNOWN` operands as "expected" for bitwise ops, warning on `double` and `string`. ucode coerces both to int for bitwise operations.

## Fix

Accept `double` and numeric `string` operands for bitwise operators without warning (they are coerced). `x | 0` / `x & mask` on a double is idiomatic and harmless.
