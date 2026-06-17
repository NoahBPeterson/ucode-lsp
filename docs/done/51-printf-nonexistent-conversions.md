> ✅ **FIXED 0.6.249** (C1 cluster). The recognized conversion set is now exactly ucode's (`d i u o x X e E f F g G c s J %`). `%a %A %n %p` are flagged with **UC2011** "'%a' is not a ucode format conversion — it prints literally and consumes no argument" (no longer arg-consuming).

# printf/sprintf accept non-existent conversions `%a %A %n %p` as arg-consuming specifiers

**Severity: low-medium (false positive + false negative).** ucode's printf conversion set does not include `a A n p`. The LSP treats them as valid arg-consuming specifiers, so it both invents required arguments and mis-attributes supplied ones.

## Reproduction

```ucode
printf("%a");          // UC2006 "1 specifier(s) but only 0 argument(s) provided"  (ucode: prints "[%a]", needs no arg)
printf("%d %a", 1);    // UC2006 "2 specifiers but 1 arg"                          (ucode: prints "1 %a")
```

Verified: in ucode `a A n p` are not conversions — they hit `default: continue`, consume **zero** args, and print literally.

## Root cause

`src/analysis/checkers/builtinValidation.ts` — the conversion character class in `formatRegex` (≈ line 31) includes `a A n p` and assigns them arg-consuming `expectedTypes`. ucode's real conversion set (C `uc_printf_common`) is only `d i o u x X e E f F g G c s J %`.

## Fix

Restrict the recognized conversions to ucode's actual set. A character that isn't a real conversion should be treated as literal text consuming no argument (matching the C parser's `default: continue`).
