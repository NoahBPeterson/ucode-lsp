# `trace()` hover documentation is wrong — it takes an integer level and throws on a string

**Severity: low (wrong doc → misleads into a runtime error).** The `trace` builtin is documented as `trace(message?: string)` with an example `trace("Debug point")`, but ucode's `trace` takes an **integer trace level**, returns the previous level, and **throws** on a non-integer.

## Reproduction

The doc's own example is a runtime error:

```ucode
trace("Debug trace point");     // ucode: "Type error: Invalid level specified"
trace(0);                        // valid → returns 0 (int)
```

Verified against `ucode/lib.c` (`uc_trace`, lib.c:4133): takes an integer level, returns the previous level (integer), throws on a non-integer.

## Note

The return-type *table* entry (`typeChecker.ts:396`, `[INTEGER] → integer|null`) is correct — only the hover markdown in `src/builtins.ts:70` is fabricated.

## Fix

Rewrite the `trace` doc string to `trace(level: integer): integer` and replace the misleading string example.
