# `ubus` module namespace is missing the connection functions (`call`, `publish`, `listener`, …)

> **STATUS: FIXED in 0.6.201.** The `ubus` module's function map is now the union of the C
> `global_fns` (error/connect/open_channel/guard) and `conn_fns` (list/call/defer/publish/
> remove/listener/subscriber/event/disconnect) — exactly what `ubus.c uc_module_init()`
> registers into the module scope. The conn_fn signatures already existed as the
> `ubus.connection` object's methods, so they're reused (spread `connectionMethods` into the
> module `functions` map in `ubusTypes.ts`). `ubus.call(...)`/`ubus.publish(...)`/
> `ubus.listener(...)` no longer false-error, and completion offers them; a bogus member is
> still flagged and a real connection handle still resolves its methods. Tests:
> `tests/test-ubus-module-conn-fns.test.js` (21) + updated `tests/test-module-completeness.js`.
> Repro: `ubus-module-fns-demo.uc`.

**Severity: medium-high.** `ubus.call(...)`, `ubus.publish(...)`, `ubus.listener(...)`, `ubus.subscriber(...)` directly on the imported `ubus` module raise a false `UC3001 "Method 'X' is not available on the ubus module. Available functions: error, connect, open_channel, guard"`. The ucode `ubus` module actually registers the connection functions on the module scope as well.

## Reproduction

Real corpus: `openwrt/package/network/config/wifi-scripts/files/lib/netifd/wireless.uc`, `wireless-device.uc`, `usr/share/hostap/wdev.uc` (29 occurrences).

```ucode
import * as ubus from "ubus";

ubus.call({ ... });                       // false UC3001 "not available on the ubus module"
wireless.obj = ubus.publish("network.wireless", ubus_obj);
wireless.listener = ubus.listener("ubus.object.add", (event, msg) => { ... });
```

## Verified against the C source

`ucode/lib/ubus.c`, `uc_module_init()` registers **both** function lists into the module scope:

```c
uc_function_list_register(scope, global_fns);   // error, connect, open_channel, guard
uc_function_list_register(scope, conn_fns);     // list, call, defer, publish, remove, listener, subscriber, ...
ADD_CONST(STATUS_OK); ... ADD_CONST(STATUS_CONNECTION_FAILED);
```

So `call`, `list`, `defer`, `publish`, `remove`, `listener`, `subscriber`, `notify`, `disconnect` are all present on the `ubus` module namespace. The LSP only models `global_fns` for the module. (The `STATUS_*` constants are *not* flagged, so only the `conn_fns` are missing.)

## Fix

Add the `conn_fns` names to the `ubus` module's valid-member set (they already exist as the `ubus.connection` object's methods — the same signatures can be reused). This matches what ucode exposes; whether calling `ubus.call()` without a connection `this` is *useful* is a separate concern, but the members genuinely exist.
