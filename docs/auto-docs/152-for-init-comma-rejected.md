# Comma/sequence in a `for`-init (non-declaration) is falsely rejected

**Severity: low (false positive, parser).** A bare-expression `for`-init using the comma operator is valid ucode, but the parser stops at the comma.

## Reproduction

```ucode
let i, j;
for (i = 0, j = 0; i < 2; i++) print(i);     // ERROR "Expected ';' after for loop initializer"
```

Verified: prints `01`, exit 0. `for (i = 0; …)` (single) is fine, the **update** clause comma (`i++, j = i`) is fine, and `for (let i=0, j=0; …)` (the declaration path) is fine — only a bare-expression for-init with a comma sequence breaks.

## Root cause

`parseForStatement` (`src/parser/statements/controlFlowStatements.ts:198`) parses the init with `this.parseExpression()` (defaults to `Precedence.ASSIGNMENT`), stopping at the comma. The update clause (line 213) correctly uses `parseExpression(Precedence.COMMA)`.

## Fix

Parse the for-init at `Precedence.COMMA` (one-line change), matching the update clause.
