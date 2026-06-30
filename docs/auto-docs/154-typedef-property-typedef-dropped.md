# An `@property` whose type is another `@typedef` is silently dropped → false UC7004 (and nested props never resolve)

**Severity: low-medium (false positive).** When a typedef property references another typedef, the property vanishes from the shape entirely, so accessing it falsely errors; and even if kept, the nested typedef's shape isn't resolved.

## Reproduction

```ucode
/** @typedef {Object} Point
 *  @property {integer} x */
/** @typedef {Object} Shape
 *  @property {Point} origin
 *  @property {integer} id */
/** @param {Shape} s */
function f(s) { return s.origin; }     // UC7004 "Property 'origin' does not exist on 's'. Available: id."
```

`origin` is dropped from the (closed) shape, so `s.origin` falsely errors. And even were it kept, `s.origin.x` is never checked (hover shows `origin: unknown`).

## Root cause

`extractTypedef` (`jsdocParser.ts:230-237`) resolves each `@property` type via `resolveTypeExpression`, which returns `null` for a typedef NAME (the registry isn't consulted there) → the property is `continue`-skipped. Because the shape is then `closedPropertyShape`, accessing the dropped property errors. This is part of a cluster (findings 159, and the `@returns` typedef angle): `resolveTypeExpression` has no access to the typedef registry.

## Fix

Make `resolveTypeExpression` (or `extractTypedef`) registry-aware so a typedef-named property resolves to that typedef's object shape (kept in the parent, with nested member checking).
