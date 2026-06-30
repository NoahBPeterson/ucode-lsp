# A single un-parseable declaration produces a parser error AND a cascading "unused variable" warning

**Severity: low (cascade noise).** When a declaration fails to parse, the unused-variable pass still runs on the half-formed declarator and adds a second squiggle for the one root cause.

## Reproduction

```ucode
let x = (1 +;     // (1) "Unexpected token in expression" (Error)  +  (2) UC1006 "Variable 'x' is declared but never used" (Warning)
```

Same for `let a = {b: };` and `let z = ;` — the declaration never validly parsed, yet `x`/`a`/`z` are reported as "declared but never used."

## Why it's wrong

The variable was never successfully declared (its initializer is a syntax error), so "declared but never used" is both misleading and redundant — the user already has the real error (the parse failure) on the same line.

## Fix

Suppress the unused-variable (and other downstream semantic) diagnostics for a declarator whose initializer/declaration produced a parse error, so one broken statement yields one diagnostic.
