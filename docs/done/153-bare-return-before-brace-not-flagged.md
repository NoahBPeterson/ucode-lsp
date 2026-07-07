# A bare `return` immediately before `}` is not flagged, but ucode requires `return;`

**Severity: low (false negative, edge).** ucode does not do JS-style ASI for `return`: a value-less return must be written `return;`. `return }` (no semicolon) is a syntax error, but the LSP accepts it.

## Reproduction

```ucode
function f() { return }     // LSP: clean.  ucode: "Syntax error: Expecting expression"
```

Verified: `function f(){ return }` → ucode rejects it. But `return;`, `return 5`, `return\n5`, and `return` followed by a real statement are all fine.

## Root cause

The LSP treats a bare `return` as universally valid (no requirement of `;` or a value before `}`).

## Fix

Flag a `return` that is immediately followed by `}` (with no `;` and no value) as a missing-semicolon/expecting-expression error, matching ucode. (Obscure form, low priority — but a genuine missed syntax error.)
