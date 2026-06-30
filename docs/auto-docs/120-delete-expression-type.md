# A `delete` expression is typed `unknown` instead of `boolean`

**Severity: low (wrong inference).** `delete` always returns a boolean in ucode, but the LSP types a `delete` expression `unknown`.

## Reproduction

```ucode
let o = { a: 1 };
let r = delete o.a;     // hover r: unknown   (should be: boolean)
```

Verified: `type(delete o.a)` → `bool` (`true` on success, `false` on a missing key).

## Root cause

`typeChecker.ts` has a `DeleteExpression` case only in the child-traversal switch (≈ line 4958), not in the type-inference switch — so the expression's type falls through to `unknown`.

## Fix

Add a `DeleteExpression` case to the type-inference switch returning `boolean`. Minor, but it improves any code that uses the result of a `delete` (e.g. `if (delete o.k) …`).
