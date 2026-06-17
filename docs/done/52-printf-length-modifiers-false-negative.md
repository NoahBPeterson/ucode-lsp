> ✅ **FIXED 0.6.249** (C1 cluster). The length-modifier group was removed (ucode has none). `%lld` is now flagged with **UC2011** "ucode has no printf length modifiers (l/h/z/j/t) — '%lld' prints literally and consumes no argument" — the full sequence is quoted, not just '%l'.

# printf/sprintf length modifiers (`%lld`, `%hhd`, `%zd`) are silently accepted — false negative

**Severity: low (false negative).** ucode does not support C length modifiers (`h l z j t`). The LSP silently strips them and treats `%lld` as a valid `%d`, so a typo'd format that produces literal garbage at runtime passes review.

## Reproduction

```ucode
printf("%lld", 5);       // LSP: no diagnostic
```

Verified: `ucode -R -e 'printf("[%lld]", 5)'` → `[%lld]` — `l/h/z/j/t` are not length modifiers in ucode, so `%lld` is not a real specifier and consumes nothing; the `5` is silently dropped (or mis-attributed when combined with finding 51).

## Root cause

`src/analysis/checkers/builtinValidation.ts` — the `formatRegex` includes a `(?:hh?|ll?|[zjt])?` length-modifier group (≈ line 31), copied from C printf. ucode has no such modifiers.

## Fix

Remove the length-modifier group from the format regex; `%lld` should be diagnosed (the `l`s are literal text, leaving a bare `%` / invalid specifier) rather than silently accepted as `%d`.
