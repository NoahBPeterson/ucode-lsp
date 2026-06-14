# `@returns` / `@return` JSDoc is completely ignored for the function's return type

**Severity: medium (inference gap).** The analyzer parses the `@returns` tag but never applies it — a function's return type is always derived from body inference, so `@returns {T}` does nothing.

## Reproduction

```ucode
/** @returns {string} */
function f() { return some_opaque_call(); }
let r = f();      // hover on r: `unknown`   (should be: string)
```

```ucode
/** @returns {string} */
function f() { return 1; }
let r = f();      // hover on r: `integer` — the body (integer) wins; @returns {string} is silently ignored.
                  // This is the CONTRADICTION case: today nothing flags the bad annotation. It should
                  // instead emit a diagnostic on `@returns {string}` (it contradicts the returned 'integer').
                  // See the task below.
```

(Note: there is no `.length`/`.foo` member on a string or integer in ucode — you use the `length()` builtin — so member access can't distinguish the types here; `hover` shows the inferred type directly and unambiguously.)

## Root cause

`jsdocParser.ts` parses the `returns`/`return` tag, but nothing in `applyJsDocToParams` (or anywhere in the analyzer) consumes it — `grep` finds no `tag === 'returns'` reader. The function's return type comes solely from body inference.

## Why it matters

`@returns {T}` is the *only* way to type a function whose body returns an opaque or cross-module value (the common case for wrappers around `require()`/ubus/uci results). Ignoring it means those functions and all their call sites stay `unknown`.

## Fix

Apply the parsed `@returns` type to the function symbol's `returnType` — but **reconcile it with body inference, don't blindly trust it**. `@returns` should be allowed to *narrow/fill in* an otherwise-unknown return, never to silently override a return type the body provably contradicts.

### Task: verify `@returns` against the body; it may only narrow, not contradict

When a function has a `@returns {T}` annotation, compare `T` against the type inferred from the body's `return` statements (`R`):

1. **Body opaque (`R` is `unknown`)** → apply `T`. This is the intended use (wrappers around `require()`/ubus/uci/cross-module calls). e.g. `return some_opaque_call()` + `@returns {string}` ⇒ return type `string`.
2. **Body type is assignable to / a supertype of `T`** → apply `T` as a narrowing. e.g. body infers `string | null`, `@returns {string}` ⇒ narrow to `string` (the author is asserting the non-null path).
3. **Body provably contradicts `T`** → **emit a diagnostic** (new code, e.g. `UC70xx "@returns {string} contradicts the inferred return type 'integer'"`) on the `@returns` tag, and keep the body-inferred type (don't poison call sites with the false annotation).

The contradiction case is the important one. Today:

```ucode
/** @returns {string} */
function f() { return 5; }     // should warn: @returns {string} contradicts returned 'integer'
```

is silently accepted (the tag is ignored entirely). After the fix it must produce a diagnostic rather than either trusting the tag or ignoring it.

**Contradiction = the annotated `T` shares no member with the body's inferred return union.** Be conservative to avoid false positives:
- Treat `integer`/`double` interchangeably where ucode coerces (don't flag `@returns {double}` on `return 5`).
- A `null`-only body vs a non-null `T` (or vice-versa) where a guard/early-return is involved should fall under case 2 (narrowing), not a contradiction.
- Multiple `return` statements → infer the union of their types as `R`; contradiction only when `T` is disjoint from every arm.
- Only flag when the body return type is **concrete** (a literal, a builtin return, a typed local) — never when it's `unknown` (case 1).

This mirrors how the LSP already treats `@param` (findings 65–67): the annotation is checked for consistency, not blindly applied.
