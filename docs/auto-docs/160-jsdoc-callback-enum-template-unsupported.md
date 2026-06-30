# `@callback`, `@enum`, `@template`, and function-type params are unsupported → false UC7001

**Severity: low.** Several standard JSDoc type-definition tags aren't parsed, so referencing their names produces "Unknown type".

## Reproduction

```ucode
/** @callback Handler
 *  @param {integer} code */
/** @param {Handler} cb */
function f(cb) { ... }            // UC7001 "Unknown type 'Handler'"
```

Also: `@param {function(integer): string} cb` → hover `undefined` (callback param/return not modeled); `@template T` + `@param {T} x` → UC7001 "Unknown type 'T'"; `@enum {integer}` on a const → ignored (no enum member typing).

## Fix

At minimum, register `@callback`/`@template`/`@enum` names so they don't produce false UC7001; ideally model `@callback` and `function(...)` types' parameters and return.
