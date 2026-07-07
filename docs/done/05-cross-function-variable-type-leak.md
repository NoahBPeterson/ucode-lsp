# Cross-function variable-type leak — a typed local bleeds into a same-named local in another function

**Severity: medium.** A local variable's inferred type (observed: `fs.proc` from `popen()`) leaks into a **same-named** local variable in a *different, unrelated function*, causing false member-access errors on the second variable.

## Reproduction (bisection-proven on real code)

`luci/applications/luci-app-tailscale-community/.../tailscale.uc`:

```ucode
function exec(command) {
    let p = popen(command, 'r');      // p : fs.proc
    ...
    let exit_code = p.close();
    ...
}

// ...much later, a different object method...
for (let p in status_data?.Peer) {
    p = status_data.Peer[p];          // p is now a Peer object
    peer_map[p.ID] = {
        ip:       join('<br>', p?.TailscaleIPs) || '',   // "Method 'TailscaleIPs' does not exist on fs.proc"
        hostname: split(p?.DNSName || '', '.')[0] || '', // "Method 'DNSName' does not exist on fs.proc"
        ostype:   p?.OS,                                  // ... 12 false errors total
        ...
    };
}
```

The second `p` (a JSON object) is typed as `fs.proc` — the type of the *first* function's `p`.

**Proof it is a leak, not a true positive:** renaming the `popen`-assigned `p` in `exec()` to `pp` makes **all 12** `fs.proc` errors in the unrelated `get_status` method disappear. The two `p` variables live in different function scopes and should be fully isolated.

## Notes

The minimal trigger is narrow (it did not reproduce with a 3-line two-function sketch — it depends on the surrounding structure: `'use strict'`, an object-literal method, a `for (let p in …)` whose loop var is reassigned, optional chaining). But the bisection on the shipping file is conclusive: a `fs.proc`-typed local named `p` poisons a same-named local elsewhere. The bug is in how the symbol table / checked-type cache keys variable types — likely keyed (partly) by name rather than strictly by scope.
