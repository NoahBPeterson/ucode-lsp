> ✅ **FIXED 0.6.249** (C1 cluster). The format parser was rewritten to mirror `uc_printf_common` exactly; positional `%N$` is recognized and counted/type-checked by index. Bonus strictness: a referenced-but-missing index or a supplied-but-unreferenced arg (gap/trailing) is flagged.

# printf/sprintf positional arguments (`%N$`) are unrecognized → false UC2006

**Severity: medium (false positive).** ucode's printf supports positional conversions (`%1$d`, `%2$s`), but the LSP's format parser doesn't, so every positional format string is mis-counted and flagged `UC2006`.

## Reproduction

```ucode
printf("%1$d", 5);            // UC2006 "format string has 0 specifier(s) but 1 argument(s) provided"
printf("%2$s %1$s", "a", "b"); // UC2006 "0 specifiers but 2 args"
```

Verified: `ucode -R -e 'printf("[%1$d]", 5)'` → `[5]`; `printf("[%2$s %1$s]", "a","b")` → `[b a]`. Both valid, both consume their args.

## Root cause

`src/analysis/checkers/builtinValidation.ts` — the `formatRegex` (≈ line 31) has no `\d+\$` positional branch. The leading digit lands in the width group and the `$` breaks the match, so `%1$d` is treated as non-specifier text. Result: zero specifiers detected, so every supplied argument looks "extra", and per-position type checks are skipped too.

## Fix

Extend `formatRegex` to recognize an optional `\d+\$` positional prefix, and account for positional indices when counting/type-checking arguments.
