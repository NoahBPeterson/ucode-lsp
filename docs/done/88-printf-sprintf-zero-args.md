> ✅ **FIXED 0.6.249** (C1 cluster). The hard arity error is gone (ucode accepts zero args). Per the "stricter for builtins" rule it's now a **UC2012** *warning* ("printf() with no arguments has no effect") rather than silence — provably useless, even though valid.

# `printf()` / `sprintf()` with zero arguments are falsely flagged

**Severity: low (false positive).** Calling `printf()` or `sprintf()` with no arguments raises `Function 'X' expects at least 1 argument(s)`, but ucode accepts a zero-argument call.

## Reproduction

```ucode
printf();              // ERROR "Function 'printf' expects at least 1 argument(s), got 0"
let x = sprintf();     // ERROR "Function 'sprintf' expects at least 1 argument(s)"
```

Verified: `ucode -R -e 'printf(); print("ok\n")'` → prints `ok` (no error); `sprintf()` likewise runs. Both treat a missing format string as empty output.

## Root cause

`printf`/`sprintf` are modeled with a minimum arity of 1, but the C implementations tolerate `nargs == 0` (the format defaults to empty / null is handled).

## Fix

Set the minimum arity of `printf`/`sprintf` to 0. (Minor — a zero-arg `printf()` is pointless — but it is a verified false positive on valid code.)
