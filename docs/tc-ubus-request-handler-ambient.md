# ubus published-object method-handler `req` ambient shape

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit. The single largest
*framework-callback* driver in the member-read slice: the `req` parameter of a `ubus` object-method
handler is completely untyped, so every `req.args.*` / `req.type` / `req.info.*` read hovers as
`unknown`. Verified against the vendored `ucode/lib/ubus.c`.

## The gap

`conn.publish(name, methods)` registers a ubus object; each method's `call` handler is invoked with a
single **request object** the ucode runtime constructs. That object has a fixed, C-defined shape — but
`publish`'s `methods` parameter is typed only as a bare `object` (`src/analysis/ubusTypes.ts:45`), the
handler function inside it gets no contextual param type, so `req` is `unknown` and every access off it
is `unknown`.

```ucode
// uspot/files/usr/share/uspot/uspot.uc:818  (real corpus)
uconn.publish("uspot", {
    client_auth: {
        call: function(req) {                 // req: unknown
            let uspot   = req.args.uspot;      // req.args: unknown → uspot: unknown  (line 822)
            let address = req.args.address;    //                     address: unknown (823)
            let client_ip = req.args.client_ip;
            ...
        }
    }
});
```

```ucode
// openwrt/package/network/services/hostapd/files/hostapd.uc:1143
function dpp_channel_handle_request(channel, req) {
    let data = req.args ?? {};                 // req.args: unknown → data: `object | unknown`
    switch (req.type) {                        // req.type: unknown (should be string)
    case "start":
        if (!data.ifname) ...                  // data.ifname: unknown
    }
}
```

Same pattern recurs in `luci-app-ddns/.../ddns.uc` (`call: function(req){ … }`),
`unetd/files/unet.uc`, and every rpcd/ubus service. In the audit the `req.args*` clusters total
roughly **150+ occurrences** (`req.args` 49, `req.args.uspot` 48, `req.args.address` 22,
`req.args.interface` 18, plus the hostapd `data = req.args ?? {}` fan-out).

## Root cause (verified against `ucode/lib/ubus.c`)

The request object is built by `uc_ubus_object_call_cb` and pushed as the handler's sole argument
(`uc_ubus_handle_reply_common`, ubus.c:2437-2532). It is a `ubus.request` **resource** whose prototype
is `reqproto`:

| handler kind | site | prototype members added |
|---|---|---|
| published-object method (`call:`) | ubus.c:2557-2563 | `args` (object), `info` (object, see below) |
| subscriber notify (`subscribe_cb`) | ubus.c:3061-3071 | `type` (string), `data` (object), `info` (object) |
| channel method | ubus.c:3598-3604 | `args` (object), `type` (string, when method present) |

`info` is built by `uc_ubus_object_call_info` (ubus.c:2400-2432):
`{ acl: { user:string, group:string, object?:string }, object: { id:integer, name?:string,
path?:string, method?:string } }`.

The resource itself carries the `request_fns` prototype (ubus.c:3861): `reply(reply)`, `error(code)`,
`defer()`, `get_fd()`, `set_fd(fd)` — so `req.reply(...)` etc. are also typeable.

`req.args`' *values* are supplied by the ubus caller and shaped by the method's declared `args:`
template (ubus.c:2596: `ucv_object_get(ubus_method_definition, "args", …)`). They are **not** knowable
from the request object alone → they are an honest `unknown` (see "Partially solvable" below).

Today none of this is modelled: `src/analysis/ubusTypes.ts` types `publish`'s `methods` param as
`object`, and there is no machinery that types a callback parameter from the surrounding call's
contract. The `call: function(req)` param falls through `applyJsDocToParams`'s "no JSDoc → UNKNOWN"
branch (`semanticAnalyzer.ts:3756`) like any other param.

## Proposed approach

Introduce a `ubus.request` object type (parallel to the existing `ubus.deferred` / `ubus.object`
handle types in `ubusTypes.ts` + `OBJECT_REGISTRIES`) with:
- methods `reply`/`error`/`defer`/`get_fd`/`set_fd` (from `request_fns`),
- properties `args` → `object`, `type` → `string`, `data` → `object`, and `info` → a nested shape
  (`acl` / `object` sub-objects with the fields above).

Then **contextually type the handler parameter**: when a function literal appears as the `call`
value of a method entry inside a `conn.publish(name, {...})` (or `subscribe_cb`) argument, declare its
first param as `ubus.request`. Detection mirrors the existing uhttpd/netifd ambient work
(`src/analysis/uhttpdTypes.ts`, `declareUhttpdAmbient` / `forceGlobalDeclaration`), except the anchor
is a **call-argument object-literal method slot**, not a whole-file handler mode. The connection
object is already a known handle type (`ubus.connection`), so the `.publish(...)` call site is
statically recognizable.

Two implementation tiers:
1. **Base req shape (solvable).** `req` → `ubus.request`; `req.args`/`req.data` → `object`,
   `req.type` → `string`, `req.info.*` → the fixed shape, `req.reply()/error()/…` typed and
   completed. This kills the `req.type`/`req.info` unknowns and turns `req.args` from `unknown` into
   `object` (so `data = req.args ?? {}` becomes `object`, not `object | unknown`).
2. **`req.args` member values (partially solvable, follow-on).** Read the sibling `args:` schema of
   the *same* method entry (`{ call: fn, args: { uspot: "", address: "" } }`) and stamp
   `req.args`' `valuePropertyTypes` / a per-key propertyTypes from the sample values' types. Where no
   `args:` schema is declared, `req.args` members stay `unknown` (honest — caller-defined).

## Soundness risks

- **`args` nullability.** `blob_array_to_ucv` can yield `null` when the caller sends no data; type
  `req.args` as `object | null`? Verify against ubus.c: `reqproto.args` is added unconditionally from
  `args` which may be a null ucv. Safer to type `object | null` so a `req.args.x` deref isn't
  falsely promised non-null. (The hostapd code's `req.args ?? {}` guards exactly this.)
- **Detection over-reach.** Only fire inside a recognized `<ubus.connection>.publish(...)` /
  `.subscribe(...)` call. Do not key on the bare method-object shape (`{call: fn}`) alone — that
  pattern is common elsewhere. Bail if the callee connection isn't a known `ubus.connection` handle.
- **Param already annotated / shadowed.** If the handler has an explicit `@param` for the first
  param, respect it (don't override). Use `scopeRoles`/`collectScopeBindings` for the param binding.
- **`args:` schema inference.** The schema sample values are *type exemplars*, not real values —
  infer only the base type of each (`"" → string`, `0 → integer`, `[] → array`); never claim the
  literal value. Absent schema ⇒ leave values `unknown`, never guess.

## Classification

**Partially solvable.** Base `req` shape (methods + `args`/`type`/`data`/`info`) is fully solvable
from the C contract — **~100-150 occurrences** (the `req.type`/`req.info` reads and the `object |
unknown` collapse). The `req.args` *member values* are partially solvable via the sibling `args:`
schema (a further ~100 `req.args.<name>` occurrences across uspot/luci/hostapd) and otherwise an
honest `unknown`. Related prior art: `docs/scope-injection-ambient-globals.md` (ambient detection
pattern), `docs/done/04-ubus-module-missing-conn-fns.md`, and the uhttpd handler ambient
(`uhttpdTypes.ts`).
