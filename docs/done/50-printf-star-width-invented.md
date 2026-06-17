> ✅ **FIXED 0.6.249** (C1 cluster). `*` is no longer modeled (ucode prints `%*d` literally). Instead of the fabricated specifier, a targeted **UC2011** warning names the C-ism: "ucode does not support '*' dynamic width/precision — '%*d' prints literally and consumes no argument".

# printf/sprintf `*` dynamic width/precision is invented → false UC2006

**Severity: low-medium (false positive).** ucode's printf does **not** support `*` (dynamic width/precision), but the LSP fabricates an extra integer specifier for it, producing a false argument-count error.

## Reproduction

```ucode
printf("%*d", 42);       // UC2006 "format string has 2 specifier(s) but only 1 argument(s) provided"
```

Verified: `ucode -R -e 'printf("[%*d]", 42)'` → `[%*d]` — `*` is not a ucode feature; the C parser hits `default: continue`, consumes nothing, and prints the text literally with **no error**. (`%.*f` likewise.)

## Root cause

`src/analysis/checkers/builtinValidation.ts` (≈ lines 67-72) treats `*` as a dynamic-width marker and fabricates an extra `INTEGER` specifier, inflating the specifier count.

## Fix

Remove the `*` width/precision handling — in ucode `%*d` is literal text and consumes no argument. (Combined with finding 51, the format mini-language model needs to match ucode's actual conversion set, not C's.)
