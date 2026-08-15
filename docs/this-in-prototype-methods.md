# `this` inside a prototype method is typed `object` unconditionally

Status: **OPEN — 🟡 MEDIUM PRIORITY** (hard-error UC2004 FP on an idiom from
ucode's own documentation). Found 2026-08-10 while building UC2017
(docs/json-parse-not-serialize.md).

## The false positive

Straight from ucode's `json()` documentation — a streaming source built by
attaching `read()` to an **array** via `proto()`:

```ucode
let x = proto(
    [ '{"foo":', 'true, ', '"bar":', 'false}' ],
    { read: function() { return shift(this) } }
);
let v = json(x);        // → { foo: true, bar: false }   (verified, owrt-main)
```

We emit a hard error on `shift(this)`:

> `UC2004: Function 'shift' expects array for argument 1, got object`

`this` here is the **array** that was proto'd, not the prototype literal. The
call is correct and the whole snippet runs.

## Root cause

`src/analysis/typeChecker.ts`, the expression dispatch:

```ts
case 'ThisExpression':
  return UcodeType.OBJECT;
```

Unconditional. That is fine for the common case (a method in an object literal,
called as `obj.method()`), but ucode has no class system — a method is just a
function value, and `proto()` can attach it to **any** value: an array, a
resource, another object. `this` is then whatever the method was invoked on.

## Options

1. **Targeted (recommended).** When the function literal is a property of an
   object literal that is passed as the SECOND argument of `proto(value, …)`,
   `this` is the proto'd value, not the literal. Type it from `proto()`'s first
   argument when that is statically known (here: `array`), else `unknown`.
   Narrow, and it fixes the documented idiom exactly.
2. **Sound but wide.** Type `this` as `unknown` whenever the enclosing function
   is not provably invoked as a member of a known object. Correct, but it would
   ripple through every `this.foo` member check and — under `'use strict'`,
   where an unknown argument is an error — could turn a large amount of
   `this`-using corpus code red. Needs a corpus differential before attempting.
3. Do nothing and accept the FP on proto'd methods (they are rare in OpenWrt
   code — this is the only instance found across the tracked trees).

## Notes

- UC2017 itself already handles `proto()` correctly: anything `proto()` has
  touched is treated as unprovable, so `json(x)` above is silent. This ticket is
  only about `this` INSIDE the attached method.
- Demo: `zzzz/json-parse-only-demo.uc` section 4(d) carries the snippet with the
  remaining squiggle annotated.
