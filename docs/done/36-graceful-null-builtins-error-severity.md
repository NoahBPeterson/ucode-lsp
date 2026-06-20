# `uniq` / `iptoarr` / `arrtoip` / `b64dec` flag a type mismatch as an **error**, but they return `null` gracefully

**Severity: low-medium (false positive at error severity).** These builtins raise a severity-1 error on a wrong-typed argument, but in ucode each returns `null` without throwing — the same "total / graceful-null" shape that `length()` is already (correctly) treated as.

## Reproduction

```ucode
uniq("abc");       // ERROR "Function 'uniq' expects array for argument 1, but got string"
iptoarr(123);      // ERROR "expects string ..."
arrtoip("x");      // ERROR "expects array ..."
b64dec(123);       // ERROR "expects string ..."
```

Verified: all exit 0 in `/usr/local/bin/ucode` and return `null`.

## Root cause (C source)

Each does `if (ucv_type(x) != UC_…) return NULL;` with no exception: `uc_uniq` (`lib.c:4927`), `uc_iptoarr` (`2975`), `uc_arrtoip` (`3053`), `uc_b64dec` (`4641`).

## Why it matters

Passing a possibly-wrong value to one of these is a `null`-producing no-op, not a crash, so a red error squiggle overstates it. The codebase already treats `length()` as total (it is not flagged at error severity). These should match — a warning at most.

## Fix

Demote the wrong-type diagnostic for the graceful-null builtins to a warning/hint, or suppress it when the value could legitimately be the wrong type.
