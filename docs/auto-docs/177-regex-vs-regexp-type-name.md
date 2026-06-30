# `regex` vs `regexp` type-name inconsistency

**Severity: low (naming).** The LSP displays a regex value's type as `regex`, but ucode's `type()` returns `regexp` — so hover/display doesn't match what the runtime reports.

## Reproduction

```ucode
let r = /abc/;
r;        // hover: `regex`
```

Verified: `type(/x/)` → `regexp` in ucode.

## Root cause

The type enum uses `REGEX = 'regex'` (`src/analysis/symbolTable.ts:26`), so every regexp-typed value displays a name that doesn't match `type()`.

## Fix

Display the type as `regexp` (matching `type()`), either by renaming the enum value or mapping it at the display layer. Minor but user-visible (and confusing when comparing to `type()` output).
