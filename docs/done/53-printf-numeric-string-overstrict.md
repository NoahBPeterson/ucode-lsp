> ✅ **FIXED 0.6.249** (C1 cluster). A numeric conversion now accepts a string (ucode coerces). The precise line: a statically **non-numeric string literal** (`printf("%d","hello")` → 0) is still flagged UC2007 as a footgun; a numeric literal (`"42"`) and any runtime string are clean.

# UC2007 over-strict: a numeric-string argument to `%d`/`%x`/… is flagged, but ucode coerces it

**Severity: low (borderline false positive).** Passing a string to a numeric conversion raises `UC2007`, but ucode coerces a numeric string cleanly.

## Reproduction

```ucode
printf("%d", "42");      // UC2007 "argument 2 has type 'string' but format specifier '%d' expects integer or double"
```

Verified: `ucode -R -e 'printf("[%d]", "42")'` → `[42]`, exit 0.

## Discussion

`src/analysis/checkers/builtinValidation.ts` (≈ lines 49-53) omits `STRING` from the `expectedTypes` of numeric conversions, so **all** string arguments are flagged. This is partly defensible — a non-numeric string (`"abc"` → `0`) is a real footgun — but it fires on legitimate numeric strings (`"42"`, which is common when forwarding `getenv`/config values).

## Fix (suggested)

Either accept `string` for numeric conversions (ucode coerces), or downgrade to a warning and only flag when the string is statically known to be non-numeric. As-is it produces noise on valid `printf("%d", some_numeric_string)`.
