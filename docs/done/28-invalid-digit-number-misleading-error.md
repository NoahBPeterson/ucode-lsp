# Invalid-digit number literals (`0o9`, `0xG`) produce a misleading cascade error

**Severity: low (message clarity).** A number literal containing a digit invalid for its base (`0o9`, `0b2`, `0xG`) is `Invalid number literal` in ucode. The LSP does flag *something*, but it stops the digit scan at the bad character, emits a valid number token, and the leftover character then trips an unrelated parser error — pointing at the wrong cause.

## Reproduction

```ucode
let x = 0o9;     // LSP: "Expected ';' after variable declaration"
let x = 0xG;     // LSP: "Expected ';' after variable declaration" + "Undefined variable: G"
let x = 0b2;     // LSP: cascade error
```

ucode for all of these: `Syntax error: Invalid number literal`.

## Root cause

`src/lexer/ucodeLexer.ts` — `parseNumber()` consumes only the valid leading digits and emits a number token; the invalid trailing digit (`9`, `G`, `2`) is re-lexed as a separate token, producing a confusing "Expected ';'" and even a phantom `UC1001 Undefined variable: G`.

## Fix

When the character immediately following a numeric literal is an alphanumeric that is invalid for the literal's base, emit a single `Invalid number literal` diagnostic on the whole token instead of letting the stray character cascade. (Same `parseNumber()` site as findings 25 and 26 — the number lexer needs digit-validity and boundary checks generally.)
