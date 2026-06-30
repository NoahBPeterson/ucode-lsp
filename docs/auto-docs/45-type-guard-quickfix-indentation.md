# Type-guard quick-fix indents the inserted body with a hardcoded tab, mismatching surrounding code

**Severity: low (code-action quality).** The "Add type guard" quick fix inserts a guard whose body line uses a leading-spaces-plus-`\t` indentation, which doesn't match files that use spaces.

## Reproduction

In a 2-space-indented file:

```ucode
function f(x) { let r = split(x, ","); ... }
```

Accept "Add type guard for `x`". The inserted edit is:

```
  if (type(x) != "string")
  \treturn;        <-- leading 2 spaces + a literal tab
```

while the file uses 2-space indentation throughout.

## Root cause

`src/server.ts` onCodeAction → `generateTypeNarrowingQuickFixes` emits the `return;` line with a hardcoded `\t`. The guard logic and insertion point are otherwise correct; only the indentation is wrong.

## Fix

Derive the inserted body's indentation from the enclosing line's leading whitespace (or the document's detected indent unit) instead of a literal tab.
