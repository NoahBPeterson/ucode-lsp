> ✅ **FIXED 0.6.250.** `uc`/`lc` are total (stringify anything), so a non-string is no longer a hard error. A DEFINITE non-string, non-null arg is now a **warning** (non-strict) / **error** (`'use strict'`), carrying a **"Coerce to string" quick-fix** that wraps the arg as `"" + value` (parenthesizing only when the arg's AST node needs it). A `string|null`/null arg keeps the existing "possibly null" handling (null wants a guard, not blanket coercion). New `coercesArgToString` signature flag + `generateCoerceToStringQuickFix`. Tests: `test-uc-lc-coerce.test.js`.

# `uc()` / `lc()` flag a coercible non-string argument as an **error**, but ucode coerces it

**Severity: low-medium (false positive at error severity).** Passing a non-string to `uc()` / `lc()` raises a **severity-1 error**, `Function 'uc': Argument is possibly 'integer', expected 'string'. Use a guard or assertion.` — but ucode coerces the argument to a string and runs fine.

## Reproduction

```ucode
print(uc(5));               // ERROR "Argument is possibly 'integer', expected 'string'"
let n = 1 + 2; print(uc(n)); // ERROR (origin is an arithmetic result, not a bare parameter)
print(lc(255));            // ERROR
```

Verified against `/usr/local/bin/ucode`: `uc(5)` → `"5"`, `lc(255)` → `"255"` (exit 0). ucode's `uc`/`lc` stringify any value.

These are not the by-design "unknown parameter" warnings — the arguments have concrete observed types (an integer literal, an arithmetic result), and the diagnostic is emitted at **Error** severity, so it shows as a red squiggle on code that runs correctly.

## Why it matters / fix

`uc`/`lc` accept any value (ucode coerces to string), so a known non-string argument is not an error. If the LSP wants to nudge toward explicit strings, this should be at most a warning/hint, not an error — and ideally not fired at all when the value is a primitive ucode will coerce. Compare with `length()`, which is correctly treated as total/null-safe; `uc`/`lc` are similarly total over primitives.
