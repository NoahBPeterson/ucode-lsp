# `@param string x` (missing braces) produces two misleading diagnostics

**Severity: low (message clarity).** Forgetting the `{}` around a JSDoc type — a very common mistake — yields two contradictory diagnostics that misidentify both halves.

## Reproduction

```ucode
/** @param string x */
function f(x) { ... }
```

Produces:
* `UC7001 "Unknown type 'x'"`
* `UC7002 "@param 'string' does not match any parameter."`

## Root cause

The bare-syntax fallback regex (`@param name type`) parses `@param string x` as **name = `string`, type = `x`**, so the LSP believes you documented a parameter literally named "string" of type "x". Both halves are then wrong.

## Fix

Detect the missing-braces case (a `@param` whose first token is a known type name / not a real parameter, with no `{...}`) and emit a single clear message like `@param type must be wrapped in braces: {string}`.
