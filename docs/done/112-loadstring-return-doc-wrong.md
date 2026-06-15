> ✅ **FIXED 0.6.191** (verified 2026-06-15 triage). `loadstring`/`loadfile` hover docs (src/builtins.ts:49-50) now read `**Returns:** `function | null``. Confirmed live: hover on `loadstring(...)` shows `function | null`.

# `loadstring` hover documents the wrong return type (a function, not the execution result)

**Severity: low (hover content + return type).** The `loadstring` builtin doc says it returns `*` ("Result of executed code"), but `loadstring` returns a **compiled function** that you then call.

## Reproduction

Hover `loadstring` in `loadstring('1');` → **Returns:** `*` — "Result of executed code".

Verified: `type(loadstring("return 42"))` → `function`; you must call it: `loadstring("return 42")()` → `42`. (The doc's own example shows the `()` call, contradicting its prose.)

## Source

The `loadstring` entry in `src/builtins.ts`. The return should read roughly `function | null` / "Compiled program as a callable function". The same likely applies to `loadfile` — verify its return doc too.

## Fix

Correct the `loadstring` (and check `loadfile`) return type/description to "compiled function", and model the return as a callable so `loadstring(...)()` type-checks.
