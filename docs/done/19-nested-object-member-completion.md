# Member completion on a nested object returns the parent's keys, not the nested object's members

**Severity: medium (completion).** Completing after `obj.child.` offers the members of `obj` (or just the `child` key) instead of the members of the nested object. The type of a nested object-literal property is never resolved for completion.

## Reproduction

```ucode
let o = { inner: { x: 1, y: 2 } };
o.inner.        // completion offers: [inner]   — should offer: [x, y]
```

```ucode
let o = { a: { b: { z: 1 } } };
o.a.b.          // completion offers: [a]        — should offer: [z]

let i = o.inner; i.   // completion offers: [] (0 items) — nested type not propagated to the variable either
```

One-level completion (`o.` → `inner`) works; only the second hop and beyond fail. Verified valid ucode: nested object literals and member access (`o.inner.x`) run fine in `/usr/local/bin/ucode`.

## Impact

Deep config/data structures are pervasive in OpenWrt ucode (uci trees, ubus replies, JSON). Autocomplete is effectively unavailable past the first member, which is exactly where it is most useful.

## Notes

Hover on `o.inner.x` *does* resolve the type, so the nested property types are known to the analyzer — only the completion path fails to descend the member chain.
