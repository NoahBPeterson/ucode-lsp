# Namespace-member function calls get no signature help

**Severity: low (feature inconsistency).** Calling a function via a user-module namespace (`m.add(`) returns no signature help, even though the bare named-import form (`add(`) does.

## Reproduction

```ucode
// nsf.uc:  function add(a,b){ return a+b; }  export { add };
import * as m from './nsf.uc';
m.add(          // signature help → null
```

Compare: `import { add } from './nsf.uc'; add(` correctly returns `add(a, b)`. Both resolve the type for hover, but only the bare form gets sig-help.

## Fix

Resolve `ns.fn(` signature help through the namespace member to the underlying function's parameters (the namespace member already resolves for hover). (Related to the local-object-method sig-help gap, finding 83.)
