# Reassigning a member of a namespace-imported module is not flagged (immutable at runtime)

**Severity: low (false negative, runtime).** Module namespace objects are immutable in ucode, so assigning to `ns.member` is a runtime error, but the LSP reports nothing.

## Reproduction

```ucode
// nsc.uc:  const K = 5;  export { K };
import * as m from './nsc.uc';
m.K = 9;          // LSP: clean.  ucode: "Type error: object value is immutable"
```

Verified: `m.K = 9` → runtime `Type error: object value is immutable` (exit 254).

## Why it matters

A namespace import is a read-only view of another module; mutating it is always a bug. (This is a runtime, not compile-time, error — lower priority than the const-reassignment false negative #16, but distinct: it's about mutating an *imported namespace's* member.)

## Fix

Flag assignment to a member of an `import * as ns` namespace binding (the namespace is immutable). Requires tracking that `m` is a module namespace, which the analyzer already knows for member resolution.
