# Bare `0x` with no digits is accepted — false negative

**Severity: low (false negative).** A numeric prefix with no following digits (`0x`) is a syntax error in ucode, but the LSP emits a valid number token and reports nothing.

## Reproduction

```ucode
let x = 0x; print("a");      // LSP: no diagnostic.  ucode: "Syntax error: Invalid number literal"
let y = 1 + 0x;              // same
```

Verified against `/usr/local/bin/ucode`: `0x` (no hex digits) → `Invalid number literal`. (`0b`/`0o` bare are parsed by ucode as `0`, so the clear true bug is the `0x` case.)

## Root cause

`src/lexer/ucodeLexer.ts` — `parseNumber()` emits a `TK_NUMBER` even when zero hex/binary digits follow the prefix; `parseInt("0x", 16)` is `NaN`, but the digit count is never validated.

## Fix

In `parseNumber()`, after consuming a `0x`/`0b`/`0o` prefix, require at least one valid digit; otherwise emit an "Invalid number literal" diagnostic. (Related: finding 28 — invalid *digits* like `0o9`/`0xG` also slip through with a misleading cascade.)
