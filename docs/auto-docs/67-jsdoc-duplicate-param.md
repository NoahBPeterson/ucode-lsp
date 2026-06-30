# Duplicate `@param` for the same name silently last-wins, with no warning

**Severity: low.** Two `@param` tags for the same parameter are resolved by silently taking the last one, with no diagnostic for the contradiction.

## Reproduction

```ucode
/**
 * @param {string} x
 * @param {integer} x
 */
function f(x) { ... }     // x resolves to integer (the second tag); no warning
```

## Root cause

`applyJsDocToParams` builds a `Map` keyed by parameter name, so a later `@param` overwrites an earlier one for the same name.

## Why it matters

A contradictory duplicate `@param` is a documentation bug (TypeScript and eslint-jsdoc both flag it). Silently picking the last tag is surprising and hides the mistake.

## Fix

Emit a warning (e.g. `UC7002`-style) when two `@param` tags target the same parameter name.
