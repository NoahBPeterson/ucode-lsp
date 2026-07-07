# A transitively re-derived export loses its type (one hop of indirection)

**Severity: low (cross-file inference gap).** When a module re-exports a value it imported (`const VAL2 = VAL; export { VAL2 }`), downstream importers see `VAL2` as `unknown` — even though within the defining module `VAL2` is correctly typed.

## Reproduction

```ucode
// c.uc:  export const VAL = 99;
// b.uc:  import { VAL } from './c.uc';  const VAL2 = VAL;  export { VAL2 };
// consumer:
import { VAL2 } from './b.uc';
VAL2 + 1;        // VAL2 is `unknown` in the consumer (but `integer` inside b.uc)
```

Verified: runs, `VAL2 + 1` → 100.

## Root cause

The export-type reader only picks up a direct literal/builtin RHS; it doesn't follow `const VAL2 = VAL` when `VAL` is itself an import. One hop of indirection drops the type. (Note: the `export { x } from '...'` direct re-export syntax is separately unsupported by ucode — finding 69.)

## Fix

When reading a module's export types, resolve a `const X = Y` RHS that is itself an imported symbol (follow one+ hop), so re-derived exports carry their type.
