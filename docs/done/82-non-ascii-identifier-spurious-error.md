# A non-ASCII identifier emits a spurious extra "Expected ';'" that ucode does not

**Severity: low (cascade noise).** A non-ASCII character inside an identifier causes the lexer to split the identifier, and the parser then emits an extra `Expected ';'` that the interpreter does not.

## Reproduction

```ucode
let café = 1;
undefined_x;
```

LSP, on line 0: `Expected ';' after variable declaration` (zero-width) + `Unexpected character: é` (zero-width) + it tokenizes the name as `caf` (so a `UC1006` unused on `caf`).

ucode: only `Unexpected character` (at the `é`), no "Expected ';'".

## Root cause

The identifier scanner stops at the non-ASCII byte (same as ucode), tokenizing `café` as `caf` + an unexpected `é`. The parser then sees a dangling declaration and adds an `Expected ';'` cascade. Both tools agree the code is invalid; the LSP just adds misleading extra diagnostics (and the zero-width ranges from finding 80).

## Fix

Recover more gracefully from an unexpected character mid-identifier (consume to the next token boundary) so the parser doesn't emit a spurious `Expected ';'`. At minimum, fix the ranges (finding 80) so the diagnostics point at `café`.
