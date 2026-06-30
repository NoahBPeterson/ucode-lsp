# `length(entry) > len` does NOT narrow `entry` — and shouldn't (unsound)

Status: **investigated; current behavior is correct (no fix), with one optional polish.**
Verified vs `/usr/local/bin/ucode`. Date: 2026-06-08.

## The question

```js
function max_len(list, len) {
    for (let entry in list)
        if (length(entry) > len)
            len = length(entry);   // "Argument 1 of length() is unknown…"  ← user: "shouldn't entry be narrowed here?"
    return len + 3;
}
```

User's intuition: inside `if (length(entry) > len)`, `entry` should already be narrowed to
`string | array | object`. **It should not — that narrowing would be unsound.**

## Why it's unsound (verified)

`length()` is **total**: it returns `null` for non-collections, never errors.

```
length(5)=null  length(1.5)=null  length(true)=null  length(null)=null
length("abc")=3  length([1,2])=2  length({a:1})=1
```

And `null` compared with `>` coerces to 0, so:

```
null > 0   → false
null > -1  → true        ← !
length(5) > -5 → true    ← length of a NON-collection passes the guard
```

So `length(entry) > len` can be **true even when `entry` is an int/bool/double/null**, whenever
`len < 0`. In `max_len`, `len` is a parameter (unknown — could be negative), so the guard
establishes nothing about `entry`'s type. Treating `length(x) <cmp>` as a type guard would
narrow `entry` to `string|array|object` and then wrongly accept code that runs on a number.

This is exactly why the LSP deliberately does **not** treat `length()` as a type guard
(`length` is bounds-only, not a type predicate — same decision recorded for filter-narrowing).
The current behavior is correct.

## Two independent reasons `entry` is `unknown` here

1. **`list` is a parameter** → `unknown` → its for-in element `entry` is `unknown`. Per the
   project principle, params aren't inferred from body usage, so nothing upstream types `entry`.
2. Even with the guard, `length(entry) > len` is not a sound narrowing (above).

Neither is fixable soundly; the diagnostic is accurately reporting that `entry` is genuinely
of unknown type.

## About the diagnostic itself (optional polish)

Note what's flagged: only the **value-use** `len = length(entry)` (L4). The test-use
`length(entry) > len` (L3) is already suppressed (the 0.6.179 length-in-test-context rule).
This is consistent and intentional.

Because `length()` is **null-safe on any input**, the message "Argument 1 of length() is
unknown — narrow to string|array|object" is arguably misleading: there is **no crash to
prevent** (unlike `substr`/`split`, where an unknown arg can misbehave). The only real
consequence is that the *result* is `integer | null` (since `length(non-collection) = null`),
which is a nullable-**result** concern, not an unknown-**argument** one.

So there's a defensible option: **stop emitting the unknown-argument diagnostic for `length()`
in all contexts** (extend the 0.6.179 test-context exemption to value contexts), and instead
rely on the result being typed `integer | null` so any unsafe downstream use of that null
surfaces on its own. Caveat: 0.6.179 *deliberately kept* value-use flagged, so this reverses a
prior choice — present it as a preference call, not a bug. (In `max_len` it wouldn't even
matter much: `len + 3` would then see `len : integer | null` and could flag the `+` instead,
which is the more accurate place for a complaint.)

## Bottom line for the user

`entry` is **not** narrowed by `length(entry) > len`, and correctly so — `length()` of a
non-collection is `null`, and `null > len` is true for negative `len`, so the guard doesn't
prove `entry` is a collection. The root cause is that `entry` comes from an unknown parameter.
The only lever is whether `length()` should warn about unknown args at all given it's
null-safe — a strictness preference, not a soundness bug.
