# Deeply nested parentheses produce a spurious parse error on valid code

**Severity: low (false positive, edge).** A deeply parenthesized expression that ucode accepts is reported by the LSP parser as a syntax error.

## Reproduction

```ucode
let x = ((((( ... 1 ... )))));     // ~2500 paren pairs
```

LSP: `Expected ';' after variable declaration` + `Unexpected token in expression`. Interpreter: valid, exit 0 (handles 5000 pairs).

## Root cause

A parser recursion limit, manifesting as a wrong error message rather than a clean parse (or a clean "too deeply nested" message). Distinct from finding 117 in that the parser *recovers* (doesn't crash) but emits a false positive.

## Fix

Raise / iteratively handle the parenthesized-expression recursion, or — if a depth cap is intentional — emit an explicit "expression too deeply nested" diagnostic instead of a misleading "Expected ';'". Lower priority than 117 (no crash), but it's a false positive on valid code.
