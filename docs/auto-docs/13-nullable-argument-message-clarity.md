# `nullable-argument` message says "expects string or object" when the real issue is nullability

**Severity: low (message clarity).** When a possibly-null value is passed to `json()` (and similar string-taking builtins), the emitted message is `Function 'json' expects string or object as argument`. The diagnostic *code* is `nullable-argument` and the actual cause is that the argument **may be null** — but the message says nothing about null, and does not identify *which* argument or *why*.

## Reproduction

Real corpus (36 occurrences), e.g. `luci-app-tailscale-community/.../tailscale.uc`:

```ucode
let profiles_data = json(b64dec(profiles_b64));   // "Function 'json' expects string or object as argument"
let status_data   = json(join('', stdout));       // same message
data = json(readfile(argv[0]));                    // same message
```

`b64dec()` / `readfile()` return `string | null`, and `join(sep, x)` returns `null` when `x` is null — so the diagnostic is *defensible* (passing `null` to `json()` would fail at runtime). The problem is purely the **wording**: a developer reading "expects string or object" looks for a type mismatch, not a missing null-guard.

## Why this matters

The message contradicts its own diagnostic code. The other nullable-argument messages in the codebase are clear (`Argument 1 of length() may be null. Use a type guard to narrow to …`). The `json` / "expects string or object" variant should be brought in line:

> `Argument 1 of json() may be null (b64dec returns string | null). Add a null guard.`

This is a wording/consistency fix, not a logic change — the underlying diagnostic is sound.
