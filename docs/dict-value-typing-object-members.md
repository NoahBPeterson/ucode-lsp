# Dict/map value-typing for object-type members (`hostapd.interfaces[phy].state()`)

Status: **NOT STARTED.** Filed 2026-07-06 as the one remaining gap from the hostapd/wpas ambient
work (0.7.66, `docs/scope-injection-ambient-globals.md` Phase 3). Verified live against the running
daemon in the OpenWrt container.

## The gap

Some object-type members are **maps** whose values are themselves a known handle type. Today they're
typed as a plain `object`, so a **computed access into them loses the value type** — the derived
handle isn't type-checked, hovered, or completed, and a real runtime crash goes uncaught.

```ucode
// hostapd.uc — the canonical pattern (real, from the vendored script)
for (let phy, iface in hostapd.interfaces) {
    let st = iface.state();              // iface SHOULD be hostapd.iface → state() typed string|null
    hostapd.printf(hostapd.MSG_INFO, "%s: %s\n", phy, st);
}
let bss = hostapd.interfaces["phy0"].add_bss("/tmp/bss.conf");  // add_bss → hostapd.bss | null
bss.ctrl("STATUS");                       // bss.ctrl SHOULD resolve as hostapd.bss.ctrl()
```

Currently:
- `hostapd.interfaces` types as `object | null` (correct nullability — see below).
- `hostapd.interfaces["phy0"]` (computed access) types as `unknown` → the value type is lost.
- So `.state()` / `.add_bss()` / `.ctrl()` on the derived value resolve to `unknown` — **no method
  typing, no hover, no completion, no typo-catch (UC5004), and no return-type inference** for chains.

## The maps to type (verified from the C `uc_function_list_t` + live daemon introspection)

Source: `openwrt/package/network/services/hostapd/src/{src/ap,wpa_supplicant}/ucode.c`. The maps are
populated on the resource **prototype** (`ucv_object_add(ucv_prototype_get(global), …)`).

| member | key | value type | notes |
|---|---|---|---|
| `hostapd.interfaces` | `phy` (string) | **`hostapd.iface`** | ap/ucode.c:85. NULL until an iface is added. |
| `hostapd.bss` | `phy` (string) | **`object` → { ifname(string) → `hostapd.bss` }** | ap/ucode.c:86. TWO-level nested map. NULL until a BSS is added. |
| `wpas.interfaces` | `ifname` (string) | **`wpas.iface`** | wpas/ucode.c:49. NULL until an iface is added. |

`hostapd.iface` methods: `state()→string\|null`, `set_bss_order(array)→boolean\|null`,
`add_bss(file,index?)→hostapd.bss\|null`, `stop()→null`, `start(info?)→boolean\|null`,
`switch_channel(info)→boolean\|null`. `hostapd.bss`: `ctrl→string\|null`, `set_config→integer`,
`rename→boolean\|null`, `delete→null`, `dpp_send_action`/`dpp_send_gas_resp→boolean\|null` (CONFIG_DPP).
`wpas.iface`: `status()→object\|null`, `ctrl→string\|null`, `config→array\|boolean\|null`, `wps_set_m7`,
`dpp_send_action`, `dpp_send_gas_req`. (All already defined in `src/analysis/hostapdTypes.ts` and
registered in `OBJECT_REGISTRIES`; only the map-value *plumbing* is missing.)

## Why it matters — the uncaught runtime break

Verified live: `hostapd.interfaces` / `hostapd.bss` / `wpas.interfaces` are **`null` until populated**
(that's why they're typed `object | null`). So:

```ucode
let s = hostapd.interfaces["phy0"].state();   // when no interfaces exist:
// hostapd.interfaces == null → null["phy0"] == null → null.state() → RUNTIME ERROR
//   "left-hand side is not a function" (confirmed pattern in the container)
```

We should flag calling a method on a possibly-null map value. Today we can't, because the value isn't
even typed as `hostapd.iface` — it's `unknown`, so `.state()` is silently accepted. With value-typing,
`interfaces[k]` would be `hostapd.iface | null` and the existing null-argument / null-member machinery
could warn "narrow to non-null before `.state()`".

## Current behavior in code

- `TypeChecker` member-access resolution (`src/analysis/typeChecker.ts` ~2953) resolves object-type
  methods ONLY for `!node.computed` (dotted access). **Computed access `obj[key]` on a known
  object-type member falls through** — there's no branch that maps `KnownObjectType`.`member` `[key]`
  to a value type. Lines 2813/2827/2852/2875/2914/2953/2979 are all `!node.computed`.
- The value-members (`interfaces`/`bss`) are ordinary zero-arg `FunctionSignature`s
  (`returnType: 'object | null'`) in `hostapdTypes.ts` — no notion of "this object is a map of X".

## Existing infrastructure to reuse

1. **`Symbol.valuePropertyTypes`** (dictionary value-shape inference, 0.6.107) — semanticAnalyzer
   already stashes an inferred value shape on a symbol and resolves `m[k]` / `let v = m[k]` to it
   (`semanticAnalyzer.ts` ~2851-2866, and `computeValuePropertyTypes` ~6109-6237). That's the closest
   mechanism, but it's for *inferred* dict shapes on user variables, not *declared* registry maps.
2. **`OBJECT_REGISTRIES` + `resolveReturnObjectType`** (`moduleDispatch.ts`) — the value types
   (`hostapd.iface`, etc.) already resolve; we just need to route `interfaces[k]` to them.
3. **`docs/registry-value-shape-inference.md`** — the deferred GENERAL design for "a registry object
   held at closure scope whose values share a shape." This ticket is the *declared-type* special case
   (we know the value type from C, no inference needed) → strictly easier than the general problem.

## Design options

**Option A — a `mapValueType` field on the value-member signature (targeted, lowest-risk).**
Add optional `mapValueType?: KnownObjectType | string` to `FunctionSignature` (or a small dedicated
"property descriptor"). Set `interfaces` → `mapValueType: 'hostapd.iface'`, `wpas.interfaces` →
`'wpas.iface'`. In the `TypeChecker`, add a **computed-access branch**: when the object of a computed
`MemberExpression` is itself a `KnownObjectType`.`member` (or resolves to one) and that member has a
`mapValueType`, type the computed access as `mapValueType | null` (null because the key may be
absent). Then `.state()` resolves via `OBJECT_REGISTRIES['hostapd.iface']`. `hostapd.bss` is two-level
→ either model as `mapValueType: 'hostapd.bssmap'` (a synthetic inner-map type whose value is
`hostapd.bss`) or special-case the double index. Start with the single-level maps
(`interfaces`), defer the nested `bss` map.

**Option B — a first-class map type in the type representation.** Introduce `map<K,V>` (or reuse
array-element typing machinery, which already carries an element type) so `interfaces` is
`map<string, hostapd.iface>`. More general (helps every dict), but touches the core type model and
union/display code — much larger blast radius. Prefer A first; B is the "do it properly" version and
overlaps with `registry-value-shape-inference.md`.

## Nullability interaction (don't lose it)

Two independent nullabilities compose:
- the **map itself** is `object | null` (null until populated), and
- **indexing** a map with a possibly-absent key yields `V | null`.

So `hostapd.interfaces[phy]` is soundly `hostapd.iface | null`. The value-typing must preserve the
`| null` so the "method on nullable" diagnostic can fire — that's the whole point (catch the
`null.state()` crash). Do NOT type it as a bare `hostapd.iface`.

## Test cases

- `for (let phy, iface in hostapd.interfaces) iface.state();` → `iface` typed `hostapd.iface`;
  `state()` returns `string | null`; hover on `state` shows the signature; `iface.` completes iface
  members; `iface.bogus()` → UC5004 (iface is a strict handle).
- `hostapd.interfaces["phy0"].add_bss("/f")` → typed `hostapd.bss | null`.
- SOUND: `hostapd.interfaces["phy0"].state()` with no null-guard → a "method on possibly-null" warning
  (the uncaught crash today). And `wpas.interfaces[x].status()` likewise.
- Regression: a plain user `let m = {}; m["k"].foo()` unaffected; `hostapd.data["k"]` (data is a plain
  scratch object, not a typed map) stays `unknown`, no false value-type.

## Scope note

This is broader than hostapd — it's the declared-map-value-typing feature. hostapd/wpas is the
concrete, C-verified driver (and the only place it currently matters), so implement Option A there
first; the field + computed-access branch then generalizes to any object-type member that is a typed
map. Leave the two-level `hostapd.bss` map and the general `map<K,V>` (Option B) as follow-ons.
