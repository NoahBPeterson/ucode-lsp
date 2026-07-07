# Alternate-order `@typedef Name {Object}` is not recognized → false UC7001

**Severity: low (false positive).** JSDoc tooling commonly accepts both `@typedef {Type} Name` and `@typedef Name {Type}`, but the LSP only recognizes the first, so the reversed order produces "Unknown type".

## Reproduction

```ucode
/** @typedef Point {Object}
 *  @property {integer} x */
/** @param {Point} p */
function f(p) { return p.x; }     // UC7001 "Unknown type 'Point'"
```

`typedefRegex` only matches `{type} Name`; the reversed order produces no `typedef` tag (`extractTypedef` → `null`).

## Fix

Recognize the `@typedef Name {Type}` order in addition to `@typedef {Type} Name`.
