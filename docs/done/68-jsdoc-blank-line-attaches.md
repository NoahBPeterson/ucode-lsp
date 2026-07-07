# A JSDoc comment separated from a function by blank line(s) still attaches to it

**Severity: low.** A doc comment with one or more blank lines before the function still binds to that function, diverging from the JSDoc/TypeScript convention that a blank line *detaches* a doc comment.

## Reproduction

```ucode
/** @param {string} x */

function f(x) { ... }     // x is still typed `string` despite the blank line
```

## Root cause

`findLeadingJsDoc` (in `src/parser/parserUtils.ts`) only requires that the gap between the comment and the declaration be whitespace-only (within ~500 chars), so any number of blank lines is allowed.

## Why it matters

By convention a blank line ends a doc comment's association with the following declaration. The current behaviour can wrongly bind a standalone/orphaned comment — e.g. a top-of-file banner, or a `@typedef`-only block — to an unrelated function below it, applying its `@param`s to the wrong signature.

## Fix

Treat a blank line between a doc comment and a declaration as detaching the comment (require the comment to be immediately adjacent, modulo a single newline).
