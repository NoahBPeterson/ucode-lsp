# `<non-string> in object` is always false (object keys are strings) but not flagged

**Severity: low (false negative, edge case).** Object keys in ucode are always strings, so an `in` test with a non-string left operand against an object is always false — even right after assigning with that non-string index. The LSP doesn't flag this.

## Reproduction

```ucode
let o = {};
o[5] = 1;
print(5 in o);       // → false (the 5 was stringified on assignment); "5" in o → true
```

Verified: `ucode -R -e 'let o={}; o[5]=1; print("5" in o, " ", 5 in o)'` → `true false`. Confirmed in `ucode/vm.c` — `in` on an object only matches when the LHS is a `UC_STRING`.

## Why it matters

This is a real footgun: code that does `obj[key] = v` with an integer key and later tests `key in obj` will always get false. A diagnostic ("`in` on an object with a non-string key is always false; object keys are coerced to strings") would catch it. Edge case / low frequency, but a genuinely surprising ucode semantic that the LSP could surface.

## Fix

When the left operand of `in` is a statically-known non-string and the right is an object, emit an "always false" hint.
