# `rindex` base signature declares param 1 as `STRING` only, but it accepts array or string (latent)

**Severity: low (latent inconsistency).** `rindex` (and `index`) work on a string OR an array, but the declared base signature for `rindex` is `[STRING, UNKNOWN]`. No user-visible false positive fires today only because a special validator overrides it.

## Reproduction

```ucode
let a = [1, 2, 1];
rindex(a, 1);      // no false diagnostic (good) — but only because validateRindexFunction overrides
```

Verified against `ucode/lib.c` (`uc_index`, lib.c:402, shared by both): handles `UC_ARRAY` and `UC_STRING`. The base signature (`typeChecker.ts:345`) says `rindex: [STRING, UNKNOWN]`; only `validateRindexFunction` (`builtinValidation.ts:466`) overrides with `[STRING, ARRAY]`, masking the wrong base.

## Fix

Align the base `rindex` signature to `[STRING | ARRAY, UNKNOWN]` (matching `index`) so it's correct even if the special-case path is ever bypassed. Latent, but a real inconsistency.
