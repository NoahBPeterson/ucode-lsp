# Nested-dotted `@property {integer} pos.x` is mis-parsed → false "not an object" error

**Severity: low (false positive).** A dotted `@property` name (the JSDoc convention for nested shapes) is parsed as a flat property, then accessing the real nested path errors.

## Reproduction

```ucode
/** @typedef {Object} T
 *  @property {integer} pos.x
 *  @property {integer} pos.y */
/** @param {T} t */
function f(t) { return t.pos.x; }     // "Property 'x' does not exist on integer type. ucode integers are not objects."
```

The `propertyRegex` (`\w+` name) captures only `pos`, twice, typed `integer` (the second overwrites). Then `t.pos.x` falsely errors because `pos` is an integer.

## Fix

Parse dotted `@property` names (`pos.x`) into a nested object shape — `pos` becomes an object `{x:integer, y:integer}` — so `t.pos.x` is valid and typed `integer`.
