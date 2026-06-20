# uloop object methods drop `| null` on their error path

**Severity: low (missing null).** Several uloop object methods can return null on a stale/invalid handle, but are modeled as bare `integer`/`boolean`.

## Reproduction

```ucode
import * as uloop from 'uloop';
let t = uloop.timer(100, () => {});
let r = t.remaining();      // hover: integer  (should be: integer | null)
```

Verified against `ucode/lib/uloop.c`: `timer.remaining`/`cancel`, `process.pid`, `interval.remaining`/`expirations`, `signal.signo` all begin with `err_return(EINVAL)` on a stale/freed handle, so they can return null. (`set`/`kill`/`send` already carry `| null`.)

## Fix

Add `| null` to these uloop object-method return types. Low impact (only fires on a freed handle), but inconsistent with the methods that already model it.
