# `@type {T}` on a `let`/`const` is entirely unsupported

**Severity: medium (inference gap).** A `@type` annotation on a variable is silently dropped — the variable stays `unknown`.

## Reproduction

```ucode
/** @type {string} */
let x;
x;          // hover: `unknown`   (should be: string)
```

Same for `const`.

## Root cause

`jsdocParser.ts` only parses `param`, `returns`, `typedef`, and `property` tags — it doesn't even recognize a `type` tag, and nothing applies one. So `@type` is a no-op.

## Why it matters

`@type` is a standard JSDoc tag and the natural way to annotate a variable whose initializer is opaque or absent (e.g. `let cfg;` populated later, or `let x = require('mod').thing;`). Without it, such variables can't be typed at all.

## Fix

Parse the `@type {T}` tag in `jsdocParser.ts` and apply the resolved type to the declared variable's symbol.

---

## Resolution: DECLINED (0.6.234)

Considered and intentionally **not** implemented. A `@type` annotation on a variable is an
unverified assertion that the static checker would then *trust*. For a variable the analyzer
can't otherwise type, the safe default is `unknown`, which **suppresses** type checks — so
applying `@type` can only ever trade that safety away: if the author's guess is right it
catches a bug, if it's wrong it manufactures a false diagnostic or hides a real one. There is
no safety floor, which makes it a footgun on a local binding.

`@returns` (#61) *was* implemented because it survives the same test: it types a **reusable
function's contract** consumed across many call sites, the body is frequently genuinely opaque
across module/`require`/ubus boundaries, and it carries documentation value — high leverage for
the same risk. A local variable has none of that.

If a future need arises for `@type {SomeTypedef}` that applies a typedef's *property shape*
(completion + typo detection on an opaque-loaded config object), that is a different, bounded
feature and can be reconsidered on its own terms — it is not what this finding asked for.
