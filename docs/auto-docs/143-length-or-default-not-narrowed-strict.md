# `length(x || [])` is flagged "may be unknown" under strict mode

**Severity: low (false positive).** A `|| []` (or `|| {}`/`|| ""`) fallback guarantees a non-null collection, but the `||` short-circuit isn't narrowed, so `length(x || [])` in a test position is still flagged under `'use strict'`.

## Reproduction

Real corpus: `packages/net/adblock-fast/.../adblock-fast.uc:543,1775` — `return length(uci(config).changes(config) || []) > 0;`

```ucode
'use strict';
function f(x) { return length(x || []) > 0; }     // "Argument 1 of length() may be unknown"
```

Verified: `'use strict'; length(null || [])` → `0`, exit 0. The `|| []` fallback guarantees a non-null array, and it's in a `> 0` comparison (test) context where `length()` is provably total — but the `||` result type isn't narrowed past the fallback, and the length-in-test exemption (the documented length-test-context handling) doesn't cover this `> 0` form here.

## Fix

Narrow `a || b` to drop the falsy-eliminable left type when the right operand is a concrete collection (so `x || []` is `array`), and/or extend the length-in-test-context exemption to the `length(...) > 0` comparison form.
