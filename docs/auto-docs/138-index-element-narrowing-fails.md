# A constant-index element (`a[0]`) is not narrowed by a guard, even when the element type is known

**Severity: low (false positive).** `if (a[0]) { use(a[0]) }` does not narrow `a[0]` from `string | null` to `string`, even though the array's element type is known — while the parallel member form `if (o.x)` does narrow.

## Reproduction

```ucode
import { readfile } from 'fs';
let a = [ readfile('/a') ];             // a : array<string | null>
if (a[0]) { substr(a[0], 0, 2); }       // "Argument 1 of substr() is unknown"
```

Verified: inside `if (a[0])`, `a[0]` is non-null. Hover confirms `a : array<string | null>`, so the element type IS known — yet the guard doesn't carry through, and the diagnostic even says "unknown" (not "may be null"), showing the element type is dropped to unknown at the access.

## Root cause

`collectPositiveTestGuards`/`getDottedPath` (`typeChecker.ts ~3551`) carries member paths (`o.x`) through to narrowing but not constant-index paths (`a[0]`).

## Fix

Extend the guard path-tracking to constant-index access (`a[0]`), so `if (a[0])` narrows the element type the same way `if (o.x)` narrows a member.
