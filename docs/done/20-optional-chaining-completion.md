# Optional-chaining member completion (`obj?.`) falls back to the global builtin list

**Severity: medium (completion).** Triggering completion after `obj?.` offers the 91 global builtins instead of `obj`'s members. The `?.` token is not recognized as a member-access trigger, so the member-completion path is never taken.

## Reproduction

```ucode
let o = { a: 1, b: 2 };
o?.        // completion offers: [print, printf, sprintf, length, substr, split, …]  (91 builtins)
           // should offer: [a, b]   — exactly like `o.` does
```

`o.` (plain dot) completes `[a, b]` correctly; only the optional-chaining form fails.

## Why it is wrong

ucode fully supports optional chaining (verified): `o?.a` → `1`, `null?.a` → no error. `?.` is just null-safe member access, so `obj?.` must offer the same member list as `obj.`. Optional chaining is idiomatic in modern ucode (the corpus uses `status_data?.Self?.TailscaleIPs?.[0]` etc.), so this gap hits real code constantly.

## Fix

Treat `?.` as a member-access completion trigger (same handler as `.`), resolving completions from the receiver's type.
