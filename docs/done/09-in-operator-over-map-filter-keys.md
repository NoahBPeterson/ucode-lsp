# `'x' in map(...)/filter(...)/keys(...)` → false "'in' operator requires object or array on right side"

> **STATUS: FIXED in 0.6.213.** Fixed in the `in`-operator check, not the return types
> (those builtins are correctly `array | null` — they CAN return null, so the doc's
> "type them as plain array" suggestion was unsound). Bigger finding (verified vs
> `/usr/local/bin/ucode`): ucode's `in` **never throws** — `'x' in null/5/"s"/true` all → false.
> So `in` over a value that CONTAINS an array or object is a valid, null-safe membership test;
> the check now accepts that (no null guard needed for `in` — `requiresNullCheck` honors its
> long-ignored `operation` param), and only flags a right side that can NEVER be a collection
> (pure scalar/null — always false, a likely mistake). This also made the existing "possibly
> null in" warning/error obsolete (unsound — `in null` is false), so a handful of narrowing
> tests that used `in`-null as a probe were switched to member-access probes. Tests:
> `tests/test-in-operator-collection.test.js` (12). Repro: `in-operator-collection-demo.uc`.

**Severity: medium.** When the argument to `map()`, `filter()`, `keys()`, or `values()` is an unknown-typed value (typically an unannotated function parameter), the LSP does not propagate the well-known array/object return type, so using the result on the right of `in` raises an **error**: `'in' operator requires object or array on right side`.

## Reproduction

Real corpus: `firewall4/root/usr/share/ucode/fw4.uc`:

```ucode
let types = map(ipset.match, m => m[1]);     // ipset is an unannotated param -> types : unknown
if (("ip" in types || "net" in types) && ...) {   // false "'in' operator requires object or array on right side"
```

Reduced:

```ucode
function f(ipset) { let t = map(ipset.match, m => m[1]); if ('ip' in t) print('y'); }    // ERROR
function f(x)     { if ('a' in filter(x, m => m)) print('y'); }                          // ERROR
function f(o)     { if ('a' in keys(o)) print('y'); }                                    // ERROR
```

With a *known* array input it is clean (`map([[1,2]], m => m[1])`), so the problem is purely that the result type is left as `unknown` when the input is unknown.

## Why it is wrong

`map()`, `filter()`, `keys()`, and `values()` have a fixed return shape (array / array of keys / array of values) **regardless of the element type of their input**. The result should be typed `array` even when the input is `unknown`, so `in` over it is valid. Note `map(x, …)` followed by `length(...)` is already accepted — only the `in` operator (and other contexts that strictly require object/array) trips on the lost array typing.

This is an **error**, not the by-design "argument is unknown" warning, so it surfaces as a red squiggle on idiomatic OpenWrt code.
