# What `netifd` is — an `include(path, scope)`-injected global, not an error

Status: **answered.** Date: 2026-06-08.

---

## ✅ BUILT — typed, handler-gated, version-gated `netifd` ambient (0.7.61)

`netifd` is now modeled like the `uhttpd` ambient: seeded as a typed object ONLY in a detected
netifd context, so it resolves (no false UC1001), its members type/hover/complete, and it stays
`UC1001` in any other script. Two shapes, from netifd's **real C source**
(`git.openwrt.org/project/netifd.git`, `ucode.c`/`proto-ucode.c`) — see `src/analysis/netifdTypes.ts`.

### The two shapes and their version floors (verified against the OpenWrt release branches + the netifd commit each pins, refetched 2026-07-05)

| shape | members | source | first ships |
|---|---|---|---|
| **proto** `{ add_proto(handler) }` | strict stub | `proto-ucode.uc`'s `include(script_path, { netifd })` | **main only** |
| **daemon/wireless** | `log`/`debug`/`process`/`process_check`/`device_set`/`interface_get_enabled`/`interface_handle_link`/`interface_get_bridge` + props `cb`/`main_path`/`config_path`/`dummy_mode` + consts `L_CRIT`/`L_WARNING`/`L_NOTICE`/`L_INFO`/`L_DEBUG` | netifd C daemon binds it into the VM scope (`ucode.c`: `ucv_object_add(scope,"netifd",obj)` + `netifd_fns[]` + `ADD_CONST`) | **25.12+** (`main.uc` lands in 25.12) |

- `proto-ucode.uc` is **main-only** — it is NOT in the 25.12 release branch (landed 2026-02, after 25.12 branched). So on the default target (25.12) a proto handler's `netifd` is correctly `UC1001`; set `ucode.targetVersion = "main"` to develop one.
- The daemon `netifd_fns[]` is **byte-identical** across the 25.12 pin (2026-02-26), the main pin (2026-06-16), and netifd HEAD, EXCEPT `add_proto` was added to the daemon table after the 25.12 pin (harmless: daemon scripts never call it; the shape is OPEN).

### Detection & gating (`SemanticAnalyzer.detectAndDeclareNetifd`)

1. Pre-traversal scan for `netifd.<member>` usage (skipped if the file locally declares `netifd`).
2. Shape by evidence: a daemon-only member ⇒ daemon; else `add_proto`/`lib/netifd/proto/` path ⇒ proto.
3. Gate on `targetVersion` via `targetLacksFeature(target, floor)`. Below the floor, `netifd` resolves as a **plain object** (no bare "Undefined variable: netifd" cascade) but is NOT given the typed shape — so the target-unavailable API isn't hovered/completed. **Every** `netifd.<member>` usage is flagged with an actionable **UC6005** anchored on the member — "*netifd … was added in OpenWrt {floor}, but the target is {target}; target {floor}*" — so no usage looks fine. (Escalates to error under `'use strict'`, like version-gated modules.)
4. Seeded via `forceGlobalDeclaration`; outside a netifd context nothing is injected, and a locally-declared `netifd` is never hijacked.

### OPEN daemon object — the soundness call

The daemon global is **extended at runtime by ucode** (`main.uc`: `netifd.ubus = …`; `wireless.uc`:
`netifd.wireless = …`) and by the wireless/hostapd framework (`setup_failed`/`set_vlan`/…), none of
which are in the C `netifd_fns[]`. A strict object type would emit **false UC5004** on real daemon
scripts. So the object-type machinery gained an **`openMembers`** flag (`registryFactory.ts` →
`typeChecker.ts`): known members still type/hover/complete, but an unknown member resolves to
`unknown` instead of erroring. The daemon shape is open; the **proto** stub stays **strict** (its
`{ add_proto }` set is fixed, so a typo there is a genuine UC5004). Verified 0 false UC1001/UC5004
on the real `openvpn.uc`/`wireguard.uc`/`wireless-device.uc`/`main.uc`.

### Why OpenWrt-specific behavior is the DEFAULT (not opt-in)

ucode was created by OpenWrt, for OpenWrt, and is used essentially nowhere else — netifd/uhttpd/
rpcd/LuCI/firewall4 and the `fs`/`ubus`/`uci`/`nl80211` modules ARE the ecosystem. So:

- The default must be correct for ~100% of real users. Making OpenWrt globals opt-in would show
  false `UC1001` across idiomatic netifd/uhttpd code out of the box — degrading the tool for
  everyone to spare a standalone-ucode user who, ecosystem-wise, doesn't exist.
- "Doesn't work off-OpenWrt" is the ground truth we MODEL, not a bug we hide: `netifd` genuinely is
  undefined without netifd, but that code only exists to be run BY netifd. The **version gate** makes
  it precise — not "netifd always exists" but "netifd exists on the release you target" (hence
  the actionable `UC6005` "needs a newer target" note below the floor). The default target 25.12 = latest stable release, overridable via
  `ucode.targetVersion`.
- The edge case self-defends: to wrongly help a non-OpenWrt user they'd have to name a variable
  `netifd`, call netifd's exact member names on it undeclared — and the only effect is suppressing an
  "undefined variable" they'd hit at runtime anyway. No false *error* is introduced (daemon shape is
  open). So it's default **because** ucode ≈ OpenWrt, gated by usage + release so it's accurate, not
  assumed.

### Remaining (not yet built)

- **P3 — `ProtoCtx`**: type the `ctx`/`proto` object handler methods receive (13 members from
  `proto-ucode.uc`). `netifd.process(...)` return is currently `object | null` (the `proc_fns` handle
  with `.cancel()` isn't yet a registered sub-type).
- **P4 — generalize** the detection into the shared dynamic-scope engine (also covers `call(fn,_,scope)`).

## Direct answer

`netifd` is **not** a custom module and **not** a real undefined-variable error. It is a
**runtime-injected global object** supplied by OpenWrt's network interface daemon to the proto
handler scripts it loads. The LSP's UC1001 on `netifd.add_proto(...)` is a **false positive**
— do not keep treating it as a true error.

## Where it comes from

`openwrt/.../netifd/files/lib/netifd/proto-ucode.uc` is the loader:

```js
let handlers = {};
let netifd_stub = {
    add_proto: function(handler) {
        if (handler?.name) handlers[handler.name] = handler;
    },
};
include(script_path, { netifd: netifd_stub });   // ← injects `netifd` into the handler script
```

This is the **2-arg `include(path, scope)` form** (see `docs/include-scope-resolution.md`): the
scope object `{ netifd: netifd_stub }` makes `netifd` a global inside `script_path`. The proto
handler scripts then register themselves:

```js
// packages/net/openvpn/files/lib/netifd/proto/openvpn.uc
netifd.add_proto({ name: 'openvpn', config: function(ctx){...}, setup, teardown, renew });
```

So `netifd` here = `{ add_proto(handler) }`. (The wireless variant —
`wifi-scripts/.../lib/netifd/wireless.uc` — receives a *richer* `netifd` with `netifd.wireless`,
`netifd.main_path`, etc., injected by a different netifd code path; same mechanism, bigger
object.)

## Why it's tractable (unlike the prometheus `call()` case)

Same scope-injection family as `docs/call-scope-injection.md` and
`docs/include-scope-resolution.md`, but **association is easy here** because of a strong
directory convention:

- Proto handlers live at `**/lib/netifd/proto/*.uc` and call `netifd.add_proto(...)`.
- The loader + the `netifd_stub` SHAPE are both in `proto-ucode.uc` (same repo subtree).

So the scope SHAPE is auto-derivable from `netifd_stub`, and the ASSOCIATION can key on the
`lib/netifd/proto/` path convention (plus the `netifd.add_proto` usage as a self-validating
signal). That's far more resolvable than the dynamic-glob-over-absolute-path prometheus case.

## Recommendation (short term)

Treat `netifd` as a known injected global — **suppress the UC1001**, don't flag it as a true
error. Cheapest stopgaps: a per-file/per-dir directive (`/* ucode-globals netifd */`), or a
project-config entry (`docs/call-scope-injection.md` Layer-2c) mapping `lib/netifd/proto/*.uc`
→ the `netifd_stub` scope. Both are subsumed by the plan below.

---

# Implementation plan (solve later)

netifd is the **tractable beachhead** for the whole scope-injection feature: the SHAPE is a
plain object literal in one known file, and the ASSOCIATION rides a strong directory
convention. Build it here, then generalize the engine to `include`/`call` (the prometheus
case). Phased so each step ships value on its own.

## The two types to model

Both are fully derivable from `proto-ucode.uc` — no guessing.

**1. The injected global `netifd`** (from `netifd_stub`, lines 87-92):
```
netifd : { add_proto(handler: ProtoHandler): void }
```

**2. `ProtoHandler`** — the object literal passed to `add_proto` (from the call sites +
`handler[action](proto)` at line 112):
```
ProtoHandler : {
  name: string,
  available?: bool, no_device?: bool, 'renew-handler'?: bool,
  config?:   fn(ctx: ProtoCtx) -> object,
  setup?:    fn(ctx: ProtoCtx) -> *,
  teardown?: fn(ctx: ProtoCtx) -> *,
  renew?:    fn(ctx: ProtoCtx) -> *,
  dump?:     fn(ctx: ProtoCtx) -> *,    // action keys are dynamic; model the common ones
}
```

**3. `ProtoCtx`** (stretch goal) — the `proto` object every handler method receives
(`handler[action](proto)`, lines 35-82). 13 members, all in `proto-ucode.uc`:
```
ProtoCtx : {
  iface: string, proto: string, config: object, device: string,
  notify: fn, update_link: fn(up, data), run_command: fn(argv, env),
  kill_command: fn(signal), error: fn(errors), block_restart: fn(),
  set_available: fn(available), add_host_dependency: fn(host, ifname),
  setup_failed: fn(),
}
```
Modeling #3 turns `config: function(ctx) { return { ...ctx.data, ... } }` into a typed `ctx`
— big payoff, but optional; #1+#2 already clear the false errors.

## Detection algorithm (auto, no config)

For each workspace file, find the injection idiom:
```
include(<pathExpr>, <scopeObjectLiteral>)        // 2-arg include
```
When `<scopeObjectLiteral>` is an object literal, for each property `k: v` derive an
**AmbientScope** entry `k -> typeof(v)` (reuse existing object-literal + function-signature
inference). Cache keyed by the provider file. For netifd: provider = `proto-ucode.uc`,
yields `{ netifd: <type of netifd_stub> }`. (Same engine the `call(fn,ctx,scope)` case needs —
build it once, share it; see `docs/call-scope-injection.md` Layer 1.)

## Association (which files receive the scope)

`include(script_path, …)` has a **runtime** `script_path` (ARGV[0]), so it's not statically
resolvable — exactly the prometheus problem. Resolve it via convention + self-validation
instead, in priority order:

1. **Directory convention:** files matching `**/lib/netifd/proto/*.uc` are proto handlers.
2. **Self-validating usage signal:** the file calls `netifd.add_proto(...)` at top level and
   its only undefined free global is `netifd` (⊆ the AmbientScope members). Inject ONLY when
   this holds → cannot mis-type.
3. **Explicit override:** project-config `appliesTo` globs / per-file directive, for handlers
   that live off-convention.

Strategy (2) alone is nearly sufficient and safe; (1) widens completion/diagnostics to
handlers that haven't typed `netifd.add_proto` yet.

## Injection point

When a file matches: seed its module scope with the AmbientScope's typed symbols before
analysis (so `netifd` resolves + `netifd.add_proto` is a typed call), and suppress
strict-undefined for exactly those names. This is the same Layer-3 injection described in
`docs/call-scope-injection.md`; implement it generically so both features share it.

## Files to touch (estimate)

- New: scope-provider engine (detect `include(_, objLit)` / `call(fn,_,objLit)`, build +
  cache AmbientScope descriptors) — the reusable core.
- `semanticAnalyzer.ts`: seed injected globals into module scope + suppress UC1001/strict for
  injected names (mirror `hoistBareRequireModules` / `setImplicitGlobalNames` plumbing).
- Association resolver: convention globs + ⊆ self-validation gate.
- Optional config reader (`.ucode-lsp.json`) shared with the `-D`/ambient-scope work
  (`docs/cli-defined-globals.md`, `docs/call-scope-injection.md`).

## Test fixtures (already in-tree)

- Provider: `openwrt/.../netifd/files/lib/netifd/proto-ucode.uc`.
- Consumers: `packages/net/openvpn/files/lib/netifd/proto/openvpn.uc`,
  `openwrt/.../wireguard-tools/files/wireguard.uc`.
- Expectations: no UC1001 on `netifd`; `netifd.add_proto` typed; (stretch) `ctx` inside
  `config/setup/...` typed as `ProtoCtx`. Negative test: a non-handler file with a stray
  `netifd` reference whose other globals are NOT ⊆ the scope must STILL flag (no over-inject).

## Phasing

1. **P1 — suppress** (convention + ⊆ gate): clear the false UC1001 on every proto handler.
   Highest value / lowest risk.
2. **P2 — type `netifd`** (`{ add_proto(ProtoHandler) }`): completion + arg-shape checking on
   `add_proto`.
3. **P3 — type `ProtoCtx`**: typed `ctx` inside handler methods.
4. **P4 — generalize** the engine to `call(fn,ctx,scope)` (prometheus) and the 2-arg
   `include` caller-leak, retiring the per-case heuristics.

## Caveat — wireless variant

`wifi-scripts/.../lib/netifd/wireless.uc` receives a *richer* `netifd` (`netifd.wireless`,
`netifd.main_path`, …) from a different netifd code path, not `proto-ucode.uc`'s stub. The
engine must key the AmbientScope to the *correct provider* per consumer (don't assume one
global `netifd` shape) — another reason to drive association off the provider, not the name.
