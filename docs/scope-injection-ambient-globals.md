# ⚠️ HIGH PRIORITY — Scope-injection / ambient globals

> **Status: PARTIALLY BUILT.** ✅ **Phase 3 `hostapd`/`wpas` DONE (0.7.66)** — the two biggest
> contributors (132 + 97 = **229 of the ~250** corpus UC1001) are fixed: typed, usage/path-gated,
> version-gated ambient globals via the object-type-registry pattern (`src/analysis/hostapdTypes.ts`,
> `SemanticAnalyzer.detectAndDeclareHostapd`). netifd (Phase 1, 0.7.61) + uhttpd already shipped.
> **Remaining: Phase 2 `model` (call-scope, 44)** and any long-tail C-host globals. The hard
> *association* problem (which injection site applies to which file) is sidestepped for hostapd/wpas
> exactly as for netifd — by a specific-name usage signal + the `/usr/share/hostap/` path.

## The problem

A ucode script's *global scope can be supplied from outside the file*. Names that are
provably defined at runtime are flagged `UC1001 "Undefined variable"` (and `UC1002`
"Undefined function" when called) because a file-local static analysis can't see where they
came from. On the OpenWrt corpus this is the dominant FP family:

| global | count | injected via |
|---|---|---|
| `hostapd` | 132 | C host (hostapd daemon) |
| `wpas` | 97 | C host (wpa_supplicant daemon) |
| `model` | 44 | `call(fn, this, ctx.model.scope, …)` (cli framework) |
| `netifd` | 35 | `include(path, { netifd: stub })` (netifd dispatcher) |

## How (and when) each is introduced — verified against source

There are **three** distinct injection mechanisms (full trace in the 2026-06 investigation;
source is in the vendored `openwrt/` tree):

### 1. C-host globals — `hostapd` / `wpas`
The daemon embeds libucode and binds the name into the VM scope **before the script runs**.
`openwrt/package/network/services/hostapd/src/src/ap/ucode.c` → `hostapd_ucode_init()`:
`wpa_ucode_create_vm()` (`uc_stdlib_load`) → `uc_type_declare("hostapd.global", global_fns,…)`
→ `wpa_ucode_global_init("hostapd", …)` which does
`ucv_object_add(uc_vm_scope_get(&vm), "hostapd", global)` → `wpa_ucode_run("/usr/share/hostap/hostapd.uc")`.
So `hostapd` is a live C-backed resource in the global scope before line 1 executes.
`wpas` is the identical path in `…/src/wpa_supplicant/ucode.c`.
- **Method tables (authoritative, from the C `uc_function_list_t`):**
  `hostapd.global`: printf, getpid, sha1, rkh_derive_key, freq_info, add_iface, remove_iface, udebug_set
  `hostapd.bss`: ctrl, set_config, rename, delete (+ DPP: dpp_send_action, dpp_send_gas_resp)
  `hostapd.iface`: state, set_bss_order, add_bss, stop, start, switch_channel
  prototype also carries `data` (object) + MSG_* constants; `interfaces`/`bss` added at runtime.
- **No ucode site introduces these** — only the C does. The LSP can only know them by
  hardcoding/introspecting the daemon tables. Scripts live at `/usr/share/hostap/*.uc`.

### 2. include-scope — `netifd`
`openwrt/package/network/config/netifd/files/lib/netifd/proto-ucode.uc` is a dispatcher netifd
runs per proto action (with `script_path`/`proto_name`/`action`/`proto` injected by netifd's C).
At its top level it does:
```javascript
let netifd_stub = { add_proto: function(handler) { if (handler?.name) handlers[handler.name] = handler; } };
include(script_path, { netifd: netifd_stub });   // 2nd arg = the handler's injected globals
```
`include(path, scope)`'s second arg becomes the included file's globals, so every handler under
`lib/netifd/proto/*.uc` sees `netifd`. **This site IS in the workspace and statically
discoverable** — that's why it's the beachhead. `netifd` shape: `{ add_proto(handler) }`
(wireless.uc gets a richer one: `netifd.wireless`, `netifd.main_path`).

### 3. call-scope — `model` (cli framework / luci templates)
`openwrt/package/utils/cli/files/usr/share/ucode/cli/context.uc`:
`call(spec.parse, spec, ctx.model.scope, ctx, …)` — `call(fn, this, scope, …args)`'s 3rd arg is
the global scope for `fn`. So cli spec callbacks see `ctx.model.scope`'s keys (incl. `model`).
LuCI templates: `runtime.uc:80` `call(tmplfunc, null, scope ?? {})`.

## The unifying idea
The global scope is provided externally — by the C embedder (`uc_vm_scope_get`), by
`include(path, scope)`, or by `call(fn, this, scope)`. The names are genuinely defined at
runtime; they're just not lexical. Soundly suppressing the FP means recognizing the injection
site and treating the provided keys as defined (ideally typed).

## Phased plan (do in order)

- **Phase 1 — netifd beachhead (tractable, sound).** Recognize `include(path, { K: V })` sites
  in the workspace; for each included file, treat `K` as a defined global (suppress UC1001/UC1002).
  Strong dir convention (`lib/netifd/proto/`) + self-validating `add_proto` signal. Type `netifd`
  as `{ add_proto(handler) }` so `netifd.add_proto(...)` resolves and bogus members can be checked.
  See `docs/netifd-injected-global.md` (phased P1→P4 with the ProtoCtx shape).
- **Phase 2 — call-scope provider.** Recognize `call(fn, this, scopeExpr, …)`; infer the scope
  object's shape; inject its keys as globals into `fn`. Covers `model` (cli) + luci templates.
  See `docs/call-scope-injection.md` (the prometheus-node-exporter scope-provider design).
- **Phase 3 — C-host ambient globals.** ✅ **BUILT for `hostapd`/`wpas` (0.7.66).** No ucode site,
  so detection is by the specific-name usage signal (`hostapd.<member>` / `wpas.<member>`) OR the
  `/usr/share/hostap/` path — no curated path table or project config needed after all. Typed from
  the vendored C `uc_function_list_t` (`src/analysis/hostapdTypes.ts`: `hostapd.global`/`.bss`/`.iface`,
  `wpas.global`/`.iface`; globals are `openMembers` because the scripts add `.ubus` at runtime).
  Version floor 23.05 (below it → UC6005, no bare UC1001 cascade). Verified 0 FP on the vendored
  `files/hostapd.uc` + `files/wpa_supplicant.uc`. Tests: `tests/diagnostics/test-hostapd-wpas-ambient.mocha.js`.
  Any *other* daemon-injected global still needs a table or `.ucode-lsp.json` (see `docs/cli-defined-globals.md`).

## Related existing notes (consolidate when implementing)
- `docs/netifd-injected-global.md` — Phase-1 detail + the three derivable types.
- `docs/call-scope-injection.md` — the call()-scope provider engine + association problem.
- `docs/include-scope-resolution.md` — include() symbol leakage semantics.
- `docs/cli-defined-globals.md` — `-D NAME=val` / config-supplied globals (hardest).

## Why deferred
Each phase needs an *association* model (which injection site applies to which file) that is
sound, not heuristic. Phase 1 is self-validating and low-risk; Phases 2–3 need either a project
config surface or curated tables. High value, but a real feature — not a quick fix. **Finish it.**
