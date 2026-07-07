# Document symbols (outline) omit function parameters and factory-returned object methods

**Severity: low (feature coverage).** The outline view misses two common structures.

## Reproduction

```ucode
function make() {
    return { exec: function(a){ ... }, val: 5 };
}
```

Outline shows `make` with **no children**; `exec` / `val` are not surfaced. Function parameters never appear as symbols.

## Root cause

`src/documentSymbols.ts` — `objectMembers` only runs for an object literal bound *directly* to a variable or `this`, not one in a `return` statement. The file's own doc comment promises "methods of a factory's returned object literal are surfaced", but the `return {…}` form is not handled. Direct `let cfg = {…}` object methods *do* appear. Function parameters are never emitted.

## Fix

Surface the object literal returned from a function (the factory-return form) in the outline, and optionally emit parameters as child symbols for breadcrumbs.
