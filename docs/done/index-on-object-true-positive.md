# `index(object, …)` — a confirmed TRUE-POSITIVE diagnostic (with a quick-fix idea)

Status: **diagnostic is correct; no fix needed.** Verified vs `/usr/local/bin/ucode`.
Date: 2026-06-08. Source: `openwrt/.../cli/modules/network.uc`.

## The code

```js
function get_interfaces() {
    let ret = {};
    for (let iface in data.interface)
        ret[iface.interface] = iface;
    return ret;                       // ← an OBJECT (dict keyed by interface name)
}

function interface_validate(ctx, argv) {
    let name = argv[0];
    if (index(get_interfaces(), name) < 0)        // ← LSP: "index expects string or array, got object"
        return ctx.not_found("Interface not found: %s", name);
    return true;
}
```

## The diagnostic is RIGHT — this is a real bug

`index()` in ucode works on **arrays** (element search) and **strings** (substring search)
only. On an **object** it returns `null` — verified:

```
index({eth0:1, eth1:2}, "eth0")  → null
index({eth0:1, eth1:2}, 1)       → null
index(o, "eth0") < 0             → null < 0 → false
```

So `index(get_interfaces(), name) < 0` is **always false** → the `not_found` branch is **dead
code**. `interface_validate` accepts *any* `name`, valid or not — the existence check silently
does nothing. The LSP's "Function 'index' expects string or array for argument 1, but got
object" correctly catches this.

The author meant **object-key membership**, which in ucode is:

```js
if (!(name in get_interfaces()))            // or:  if (!get_interfaces()[name])
    return ctx.not_found(...);
```

(`"eth0" in o → true`, verified.)

## Optional enhancement — a targeted quick fix

Since this is a recognizable mistake (using `index()` for key lookup on an object), the LSP
could offer a quick fix when arg 1 of `index()` is statically an object:

- `index(OBJ, X) < 0`  →  `!(X in OBJ)`
- `index(OBJ, X) >= 0` →  `(X in OBJ)`
- bare `index(OBJ, X)`  →  suggest `X in OBJ`

This turns the (correct) error into a one-click fix to the intended membership test. Low
priority — the diagnostic already does its job — but high user delight, and the pattern is
common (people reach for `index()` by analogy to arrays).

## Note for the broader effort

Worth keeping as a reference point: amid the many false positives documented this session, this
is the diagnostic working exactly as intended — a genuine latent bug (a validation that never
validates) surfaced statically. Argument-type checking against builtin signatures earns its
keep here.
