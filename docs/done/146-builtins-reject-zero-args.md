> ✅ **FIXED 0.6.253.** `min`/`max`/`chr`/`ord`/`type`/`uchr` (and `splice`) accept zero arguments — no more false arity error. A zero-arg call is valid but pointless, so it's a UC2012 useless-call **warning** (never an error, even under `'use strict'`). The result type is narrowed precisely: `min`/`max`/`ord`/`type`/`splice` → `null`; `chr`/`uchr` → `""` (string). `ord()`/`type()` are deterministically `null` for zero args; `ord`'s with-arg form is now `integer | null` (out-of-bounds/empty-string null), except a provably in-bounds non-empty string literal like `ord("A")` → `integer`. Tests: `test-arity-coercion.test.js`, `test-reassignment-builtin-hover.test.js`.

# `min`/`max`/`chr`/`ord`/`type`/`uchr` falsely reject zero-argument calls

**Severity: low (false positive).** These builtins accept zero arguments in ucode (returning null/empty), but the LSP raises `Function 'X' expects at least 1 argument(s), got 0` at Error severity.

## Reproduction

```ucode
let a = min();      // ERROR; ucode → null
let b = max();      // ERROR; ucode → null
let c = chr();      // ERROR; ucode → "" (C explicitly returns empty string on 0 args)
let d = ord();      // ERROR; ucode → null
let e = type();     // ERROR; ucode → null
let f = uchr();     // ERROR; ucode → ""
```

Verified: `min()`/`max()`→null, `chr()`→`""` (C `uc_chr` `if(!nargs) return ucv_string_new_length("",0)`), `type()`→null, etc. — all exit 0.

## Root cause

The validators (`validateMinFunction`/`Max`/`Chr`/`Ord`/`Typelocal`/`Uchr` in `builtinValidation.ts` ~1258/1265/1418/1430/1117/1444) all call `checkArgumentCount(node, 'X', 1)`, which emits a hard error.

## Fix

Set the minimum arity of these builtins to 0 (they handle the empty case). (Same class as finding 88 for printf/sprintf.)
