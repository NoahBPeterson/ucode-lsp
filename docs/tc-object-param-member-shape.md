# Member/computed reads off object-shaped parameters lose all property typing

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit. This is the dominant
*member-read* driver: `p.field` / `p[k]` where `p` is an unannotated parameter (or a value derived
from one). It is the object-shape counterpart to `docs/tc-callsite-param-inference-local.md` (which
types only *scalar* params from call sites) — that ticket gives the param a base type but never a
property **shape**, so the member reads it enables still resolve to `unknown`.

## The gap

An unannotated parameter is declared `UNKNOWN` (`semanticAnalyzer.ts:3756`, `applyJsDocToParams`).
When that parameter is actually an object/dict, every member or computed read off it is `unknown` —
and, because the member reads out-number the declaration ~N:1, they dominate the audit's member-read
slice. Real corpus, five projects:

```ucode
// adblock-fast/files/lib/adblock-fast/adblock-fast.uc:954
function parse_options(raw, schema) {     // raw, schema: unknown
    for (let key in schema) {
        let spec = schema[key];           // spec: unknown        (schema is config_schema — a
        let v = raw[key];                 // v: unknown            module-level object literal!)
        switch (spec[0]) { ... }          // spec[0]: unknown
    }
}
// called: parse_options(uci(...).get_all(...), config_schema)   (line 990)

// openwrt/.../unetd/files/unet.uc:402
function network_delete(ctx, argv) {      // argv: unknown  (a PARAM named argv, NOT global ARGV)
    let name = argv[0];                   // name: unknown
    ...
}
function network_enroll_accept(ctx, argv, named) {
    let req = ctx.data.enroll;            // ctx.data: unknown → req: unknown  (depth-2 param read)
    let id = argv[0];
    let peer = req.peers[id];             // req.peers: unknown
}

// openwrt/.../wireguard-tools/files/wireguard.uc:90
function proto_setup(proto) {             // proto: unknown
    let iface = proto.iface;              // iface: unknown       (used 8× as a shell arg)
    system(sprintf('ip link add dev %s ...', iface));
}

// openwrt/.../cli/files/usr/share/ucode/cli/context.uc:78
let node = ctx.model.node[entry.select_node];   // ctx.model: unknown → node: unknown

// openwrt/.../wifi-scripts/.../wifi/hostapd.uc:324
if (vht_capab & 0x10 && config.rxldpc)    // vht_capab = phy_capabilities.vht_capa — param member
```

## Root cause

Three distinct shapes collapse to the same `unknown`, all rooted in an object-typed value with **no
property shape** in the symbol table:

- **(a) untyped param base** — `raw`, `schema`, `argv`, `proto`, `ctx`, `spec` are params with no
  `@param`. `semanticAnalyzer.ts:3756` stamps `UNKNOWN`; the type checker's member-access resolution
  (`typeChecker.ts:3539-3569`) requires the object identifier's `effType` to be `OBJECT` **and** the
  symbol to carry `propertyTypes` — an `UNKNOWN` param satisfies neither, so `p.x`/`p[k]` returns
  `UNKNOWN` immediately. Same for computed access via `valuePropertyTypes` (`typeChecker.ts:3531`).
- **(b) depth > 1** — `ctx.data.enroll`, `ctx.model.node`, `req.args.uspot`. Even where the base has
  a shape, the property's *own* value shape (`nestedPropertyTypes`) is usually not tracked past one
  level for arbitrary user objects, so the second hop is `unknown`.
- **(c) member value derived from a host/builtin return** — `raw = uci(...).get_all(...)`,
  `interfaces = nl80211.request(...)`, `v.ifname` in a for-in over an untyped object. The base is a
  generic `object` with no member shape (RPC/kernel payloads), so member reads are honestly unknown.

The design rule (memory: *NEVER infer a param's type from its body usage*) correctly forbids reading
`spec[0]` and concluding `spec` is an array. So the shape can only come from **annotation** or from
**the values flowing in at call sites** — neither of which is consulted for object shapes today.

## Proposed approach

Three independent levers, in increasing blast radius:

1. **Adopt `@param {Typedef}` for object params (already works — under-used).** The typedef→param
   propertyTypes path exists (`semanticAnalyzer.ts:3672-3742`, `typedefToParamInfo`): a
   `@typedef {{ iface: string, ... }} Proto` + `@param {Proto} proto` gives `proto.iface` a real
   type today. This is the honest, sound fix for framework params whose shape only the author knows.
   The gap is purely adoption — worth surfacing via a quick-fix / completion nudge, not new inference.
2. **Call-site object-shape propagation (the object extension of `tc-callsite-param-inference-local`).**
   That ticket unions *scalar* argument types onto a non-escaping file-local param. Extend it: when
   every call site passes an argument whose value has a **known property shape** — an object literal,
   or a variable/const bound to one (`config_schema`, a module-level `{...}`) — propagate that shape
   (a merged `propertyTypes`, or `valuePropertyTypes` for a uniform dict) onto the param symbol. This
   directly fixes `parse_options(raw, config_schema)` → `schema` gets `config_schema`'s shape, so
   `spec = schema[key]` and `spec[0]` type. Same escape-analysis soundness gate as the scalar ticket
   (any non-call reference bails; any call site with an unknown/shapeless arg collapses to `unknown`).
3. **Depth-N nested shape carry (lever b).** Track `nestedPropertyTypes` one hop deeper for
   value-shaped members so `ctx.data.enroll` resolves when `ctx.data`'s shape is known. Larger; do
   after 1-2.

Levers (c) — member reads off `get_all` / `nl80211.request` / `ubus.call` results — split: `get_all`
is already ticketed (`docs/done/130-uci-get-all-result-untyped.md`, `131` for the `foreach` callback
section param — the `s['.name']` / `cfg[sid]['.type']` clusters); the RPC/kernel payloads
(`nl80211.request`, `ubus.call`) are genuinely open objects and stay `unknown` by design.

## Soundness risks

- **Body-usage inference stays banned.** None of the levers may look at how the param is *used* —
  only at its declared typedef (lever 1) or the values passed in (lever 2). `spec[0]` must never
  make `spec` an array.
- **Object-shape union merge (lever 2).** Merging propertyTypes across call sites must intersect
  keys conservatively (a key absent at one site ⇒ nullable/absent), mirroring the existing
  intersection-merge in dict value-shape inference (`semanticAnalyzer.ts:7071`). A key whose type
  conflicts across sites widens to a union, not a false single type.
- **Escape = hidden call site.** Identical to the scalar ticket: any non-call reference to the
  function (stored, exported, reassigned, passed as a value) means unseen call args exist → bail.
- **Mutation after entry.** `raw[key] = …` inside the body can add keys; propagated shapes describe
  the *incoming* object, so treat them as open (permissive index), never as a closed/exhaustive shape
  that would let us claim a missing key is `null`.

## Classification

**Partially solvable.**
- Lever 1 (`@param {Typedef}`) — **already solvable**; adoption/UX only. Covers author-shaped
  framework params (`proto`, `ctx`, `model`).
- Lever 2 (call-site object-shape propagation) — **solvable** for the non-escaping file-local slice
  where call sites pass known-shape objects (`parse_options`/`config_schema` and similar), an
  estimated few-hundred occurrences (`schema`/`spec`, `raw` when fed a known object).
- Lever b/c depth + host-payload members — **partially / un-solvable**: RPC/kernel payload members
  (`nl80211.request`, `ubus.call`, `v.ifname` in a for-in over them) are honestly `unknown`.

Whole member-read slice ≈ **1,500+ occurrences**; realistically addressable by levers 1-2 ≈ a few
hundred, with the remainder either author-annotation-dependent or genuinely unknowable. Related:
`docs/tc-callsite-param-inference-local.md` (scalar sibling), `docs/planned-type-inference-todos.md`
§5 (host-context param shape), `docs/dict-value-typing-object-members.md` (declared-map value typing).
