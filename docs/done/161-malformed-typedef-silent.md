# Malformed typedefs fail silently (orphan / duplicate / no-name `@property`)

**Severity: low (missing diagnostics).** Several JSDoc mistakes are silently ignored, leaving the user with no shape and no hint of the problem.

## Reproduction

* `@property` with no enclosing `@typedef` → silently ignored (the property is orphaned, no warning).
* Duplicate `@property {integer} x` + `@property {string} x` → the second silently overwrites (`Map.set` clobber), no warning.
* `@typedef {Object}` with no name → `extractTypedef` returns `null` silently; a `@param` referencing the intended name elsewhere then gets a bare UC7001 with no hint that the typedef was malformed.

## Fix

Emit hints matching the existing `UC7001`/`UC7004` culture: "`@property` outside a `@typedef`", "duplicate `@property 'x'`", "`@typedef` missing a name". Lower severity, but they catch real documentation mistakes that currently vanish.
