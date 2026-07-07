# Member hover shows the un-narrowed type inside a guard (hover/diagnostic inconsistency)

**Severity: low (hover inconsistency).** Inside `if (o.x) { ... }`, the *diagnostic* path correctly narrows `o.x` (suppresses the nullable warning), but the *hover* path still shows the un-narrowed `string | null`.

## Reproduction

```ucode
import { readfile } from 'fs';
let o = { x: readfile('/a') };
if (o.x) {
    substr(o.x, 0, 2);   // diagnostic correctly suppressed (o.x narrowed to string)
    o.x;                 // but hover here shows: string | null  (should be: string)
}
```

The two subsystems disagree about the same position: the member guard is applied for diagnostics but not for hover.

## Fix

Route member hover through the same guard/narrowing resolution that the diagnostic path uses (`getGuardsForPosition`), so hover and diagnostics agree inside a guard.
