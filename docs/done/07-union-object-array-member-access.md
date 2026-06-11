# Dot member-access on an `object | array` union → false "Property X does not exist on array type"

> **STATUS: FIXED in 0.6.211, refined in 0.6.212.** Member access on an `object | array`
> union is no longer a hard "does not exist on array type" error (that was a false positive
> on the valid object branch) — but it is NOT silent either: accessing a property on the
> *array* branch is meaningless (returns null, never a real value), so it's a **possibly-array
> WARNING** (parallel to the possibly-null Tier 2), escalating to an **error under
> `'use strict'`**. A pure array / `array | null` (no object member) stays a hard error.
>
> **Both fix #2 (narrowing request() to `object|null`) AND arg-literal narrowing were
> REJECTED:** traced `nl80211.c` (lines 2262–2298) — the object-vs-array choice is a runtime
> reply-count property (single reply → object, multiple → array, `GET_WIPHY` merges →
> object), NOT a function of the arguments. So `nl80211.request()`/`rtnl.request()` are
> genuinely irreducible and the warning is the sound treatment (no exemption, no narrowing).
> (`ubus.list()` *could* be narrowed by arg presence — `table` = a name was passed — a
> separate future enhancement.) Tests: `tests/test-union-object-array-access.test.js` (9).
> Repro: `union-object-array-access-demo.uc`.

**Severity: medium.** Accessing `.field` (or calling `.method()`) on a value whose type is a union that includes both `object` and `array` raises `Property 'X' does not exist on array type`, even though the object member of the union has the property and ucode permits the access.

## Reproduction

Real corpus: `openwrt/.../wifi-scripts/files/usr/share/hostap/common.uc`:

```ucode
function __phy_is_fullmac(phyidx) {
    let data = nl80211.request(nl80211.const.NL80211_CMD_GET_WIPHY, 0, { wiphy: phyidx });
    return !data.software_iftypes.monitor;   // "Property 'software_iftypes' does not exist on array type"
}
```

Hover reveals the cause: `nl80211.request()` is modeled as returning `object | array | boolean | null`. Member access checks against the `array` member of the union and fails. `rtnl.request()` has the same over-broad return type and the same false positive.

Reduced:

```ucode
function f(c) { let x = c ? {a:1} : [1]; return x.a; }   // false "does not exist on array type"
function g(c) { let x = c ? {f:()=>1} : [1]; return x.f(); }  // false "does not exist on array type"
```

## Why it is wrong

Verified vs `/usr/local/bin/ucode`: dot-access on an array returns `null` (no error), so `(cond ? {a:5} : [1]).a` is safe and prints `5`. The LSP should not error when *any* member of the union supports the access.

* `object | array` → **false positive** (this bug). ucode-safe.
* `object | null` → already handled correctly (no error).
* `object | int` / `object | bool` → already handled correctly (no error).
* `object | string` → the LSP errors here too, which is *defensible* — ucode genuinely throws `left-hand side expression is not an array or object` on `"str".foo`. So scope the fix to the `array` (and `null`) cases.

## Fixes

1. Member-access on a union should succeed if at least one non-erroring member (object, or array for dot-access) supports it.
2. Narrow `nl80211.request()` / `rtnl.request()` return types from `object | array | boolean | null` to `object | null` (they return a single netlink reply object).
