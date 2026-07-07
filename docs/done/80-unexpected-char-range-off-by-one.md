# "Unexpected character" diagnostics have an off-by-one, zero-width range

**Severity: low-medium (range accuracy).** The lexer's fallback "Unexpected character" diagnostic is emitted with a zero-width range shifted one column to the right of the offending character — so the squiggle lands on the *next* character (or past end-of-line), not the bad one.

## Reproduction

```ucode
let x = @;        // '@' is at column 8.  LSP range: L0:9→L0:9 (zero-width, on the ';')
let x = 1; @      // '@' at index 11, no trailing newline. LSP range: L0:12→L0:12 (past end-of-line)
```

Expected `L0:8→L0:9` (covering the `@`) and `L0:11→L0:12` respectively.

## Root cause

`src/lexer/ucodeLexer.ts:325-327` — the unknown-character fallback calls `this.nextChar()` and then `emitToken(TokenType.TK_ERROR, ...)` **without** capturing/passing `startPos`. `emitToken` then uses `startPos = pos ?? this.pos` and `endPos = this.pos`, both equal to the position *after* the char. Every other error path in the same function correctly does `const startPos = this.pos;` before `nextChar()`.

## Fix

Capture `const startPos = this.pos;` before `nextChar()` on line 325 and pass it to `emitToken`. This also fixes the past-end-of-line variant and the BOM/surrogate range issues (findings 81).
