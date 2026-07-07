# A JSDoc union containing one unresolvable member collapses the whole type to `unknown` (no warning)

**Severity: low (silent type loss).** If any member of a `@param {A|B}` union is unresolvable, the entire union becomes `unknown` and, on some paths, no `UC7001` is emitted — so the known members are silently lost with no signal.

## Reproduction

```ucode
/** @param {string|Bogus} x */
function f(x) { ... }     // x : unknown, and no UC7001 warning
```

The resolvable `string` arm is discarded along with the unresolvable `Bogus`.

## Root cause

In `resolveTypeExpression`, the union loop does `if (resolved === null) return null;` on the first unresolved member, discarding the already-resolved members; because it returns null through the import/typedef fall-through, no warning is emitted in some paths.

## Fix

Keep the resolvable members of a union (`string|Bogus` → still type-check the `string` arm) and emit a `UC7001` for the unresolved member, rather than silently widening the whole type to `unknown`.
