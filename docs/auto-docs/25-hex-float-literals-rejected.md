# Hex float literals (`0xFF.5`) are rejected — false positive

**Severity: low (false positive).** ucode supports C-style hexadecimal floating-point literals, but the lexer stops the hex scan at the `.`, so the parser then treats the `.` as member access and emits `Expected property name after '.' or '?.'`.

## Reproduction

```ucode
let x = 0xFF.5;     // LSP: "Expected property name after '.' or '?.'"
let y = 0x1.8;      // same
```

Verified against `/usr/local/bin/ucode`: `0xFF.5` → `255.3125`, `0x1.8` → `1.5` (both run, exit 0).

## Root cause

`src/lexer/ucodeLexer.ts` — `parseNumber()` hex branch (≈ lines 336-345) returns immediately after consuming the hex digits and never consumes a fractional part (`.<hex>` / `p<exp>`). The trailing `.5` is then lexed as a member access on a number.

## Fix

Extend the hex-number scan in `parseNumber()` to accept an optional `.<hexdigits>` fraction and binary exponent (`p±<dec>`), matching ucode's grammar. (Plain `0xFF` integers already work; only the fractional form is affected.)
