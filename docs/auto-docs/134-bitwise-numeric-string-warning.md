# Bitwise operation on a numeric-string operand warns (false positive)

**Severity: low (noise).** A bitwise operator with a numeric-string operand emits a warning, but ucode coerces numeric strings to int cleanly.

## Reproduction

```ucode
let a = "5" | 2;        // WARNING "Bitwise operation on unexpected types: string | integer"
let b = "3" << "2";
let c = "5" & 0xFF;
```

Verified: `"5" | 2` → `7`, `"3" << "2"` → `12`, `"5" & 0xFF` → `5` — all valid `int`.

## Root cause

`typeChecker.ts:804-823` treats only `boolean`/`integer`/`unknown` operands as "expected" for bitwise ops, flagging `string` (and `double` — that's the separate finding 77). ucode coerces a numeric string to int64 in bitwise context.

## Fix

Accept a numeric-string operand for bitwise operators (coerced). The array/null/non-numeric-string operand cases are more defensible and can stay flagged.
