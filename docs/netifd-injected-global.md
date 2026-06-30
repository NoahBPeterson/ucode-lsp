# What `netifd` is — an `include(path, scope)`-injected global, not an error

Status: **answered.** Date: 2026-06-08.

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
