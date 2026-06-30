# Inline-object `@typedef {{x: integer}} Name` destroys the whole typedef → false UC7001

**Severity: low (false positive).** A typedef whose type is an inline object shape isn't registered at all, so every use of the name is "Unknown type".

## Reproduction

```ucode
/** @typedef {{x: integer}} Point */
/** @param {Point} p */
function f(p) { return p.x; }     // UC7001 "Unknown type 'Point'"
```

## Root cause

`typedefRegex` uses `\{([^}]+)\}`, which stops at the first `}`, so a valid `@typedef {{...}} Name` doesn't match → `extractTypedef` returns `null` → the typedef is never registered.

## Fix

Parse balanced braces in the `@typedef` type span so `{{x: integer}}` is captured and registered with shape `{x:integer}`. (Related to finding 64 — the `@param {{a:string}}` angle — but this is the `@typedef`-definition form, which loses the *entire* typedef.)
