# A non-numeric string *literal* in arithmetic always yields NaN but is never flagged

**Severity: low (false negative).** UC2008 flags `{}`/`[]` arithmetic as always-NaN, but excludes ALL strings as "value-dependent" — even a string *literal*, whose value is statically known.

## Reproduction

```ucode
let x = "abc" - 1;     // → NaN, never flagged
let y = "5px" * 1;      // → NaN, never flagged
let z = -"abc";         // unary form, also → NaN, never flagged
```

Verified: all → `NaN` / `double`. The LSP correctly skips `""` (→0), `"5"` (→5), and any non-literal string — only the non-numeric *literal* cells are missed.

## Root cause

`checkNaNArithmetic` (`typeChecker.ts:1318`) and the unary path (`:843`) exclude all strings, but `coerceStringForArithmetic`/`numericStringIsInteger` (`:1285-1305`) already classifies a literal — the same predicate proves `"abc"`/`"5px"` are non-numeric (→ NaN). So these are statically decidable, mirroring the `[]`/`{}` cases that ARE flagged.

## Fix

In `checkNaNArithmetic` (and the unary path), when a string operand is a *literal* that `coerceStringForArithmetic` classifies as non-numeric, flag UC2008 (matching the array/object handling). Keep excluding non-literal strings.
