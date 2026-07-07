# A default-imported object loses its shape

**Severity: low (cross-file inference gap).** `import D from './m.uc'` where the module does `export default {…}` types `D` as a bare `object`, dropping the literal's shape.

## Reproduction

```ucode
// d_obj.uc:  const cfg = { x:1, name:"a" };  export default cfg;
import D from './d_obj.uc';
D.x;          // unchecked, untyped
D.nope.y;     // not flagged (shape lost)
```

Verified: loads fine, `D.x` → 1. The shape `{x:integer, name:string}` is recoverable but lost across the default-import boundary. (Named imports of a typed const DO propagate their type — see the cross-file "works" notes — so this is specific to `export default`.)

## Fix

Propagate the type/shape of a default-exported value to the default-import binding (the named-import path already carries types; extend it to default exports).
