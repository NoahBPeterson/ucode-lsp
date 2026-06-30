# String indexing (`s[0]`) is not flagged, but it's a runtime error in ucode

**Severity: low-medium (false negative).** ucode strings are not indexable — `"abc"[0]` throws at runtime — but the LSP reports nothing and types the result `unknown`.

## Reproduction

```ucode
let s = "abc";
let c = s[0];          // LSP: no diagnostic, c: unknown
```

Verified: `ucode -R -e 'let s="abc"; print(s[0]);'` → `Reference error: left-hand side expression is not an array or object`. To index a string you must use `substr(s, 0, 1)`.

## Why it matters

Indexing a string is a natural mistake (it works in most languages), it's a real crash class, and the LSP already steers users from `.substring` to `substr` (`typeChecker.ts:252`) — so a diagnostic on `string[integer]` suggesting `substr(s, i, 1)` would be consistent and catch the bug at edit time.

## Fix

When indexing (`expr[idx]`) a value typed `string`, emit a diagnostic ("strings are not indexable in ucode; use `substr(s, i, 1)`"). (Array indexing is fine — `a[5]` → null, `a[-1]` → last element — so scope this to string receivers.)
