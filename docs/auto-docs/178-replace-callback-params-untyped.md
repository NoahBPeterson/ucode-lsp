# `replace(s, regex, fn)` callback parameters are untyped

**Severity: low (inference gap).** The function-replacement form of `replace` passes the full match and each capture group (all strings) to its callback, but those parameters are left `unknown`.

## Reproduction

```ucode
let r = replace("a1b2", /([a-z])([0-9])/g, function(full, c1, c2) {
    return uc(c1) + c2;     // full, c1, c2 are all `unknown` (should be `string`)
});
```

No false positive (return type `string` and the function arg are accepted correctly) — just missing inference. Verified: the interpreter passes the full match then each capture group as strings.

## Root cause

Same class as the `map`/`filter`/`sort` callback-param gaps (findings 110) — the callback's element/match parameters aren't typed.

## Fix

Type the `replace` callback's parameters as `string` (param 0 = full match, params 1..n = capture groups).
